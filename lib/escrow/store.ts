import 'server-only';
// JSON file instead of a database so the project runs with zero setup. Writes go to a temp file
// and get renamed, so a crash can't leave half a file.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Milestone, MilestoneAccess, TimelineEvent } from './types.ts';
import { sealTimeline } from './chain.ts';

const DATA_DIR = process.env.POD_DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'milestones.json');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

type DbShape = { milestones: Milestone[] };

// The two secret links of every deal are kept encrypted on disk (AES-256-GCM), so a copy of the data
// file alone hands nobody the power to pay or cancel. The key comes from POD_KEY_SECRET, or else from a
// random keyring file made once next to the data.
const KEYRING = path.join(DATA_DIR, '.keyring');
let sealKey: Buffer | undefined;
/** The key new seals use: POD_KEY_SECRET if set, else the keyring file (made once, the first time). */
function accessKey(): Buffer {
  if (sealKey) return sealKey;
  const secret = process.env.POD_KEY_SECRET;
  if (secret) return (sealKey = crypto.createHash('sha256').update(secret).digest());
  try {
    sealKey = fs.readFileSync(KEYRING);
  } catch {
    sealKey = crypto.randomBytes(32);
    fs.writeFileSync(KEYRING, sealKey, { mode: 0o600, flag: 'wx' });
  }
  return sealKey;
}
/** Every key a seal may have been made with: setting POD_KEY_SECRET later still opens the keyring's seals. */
function openingKeys(): Buffer[] {
  const keys = [accessKey()];
  try {
    const ring = fs.readFileSync(KEYRING);
    if (!ring.equals(keys[0])) keys.push(ring);
  } catch {
    // no keyring file: only the secret
  }
  return keys;
}
type SealedAccess = { sealed: string };
function sealAccess(access: MilestoneAccess): SealedAccess {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', accessKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(access)), cipher.final()]);
  return { sealed: ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.') };
}
function openAccess(stored: MilestoneAccess | SealedAccess | undefined): MilestoneAccess | undefined {
  // Deals saved before the keys were sealed still read; they are sealed on their next save.
  if (!stored || !('sealed' in stored)) return stored;
  const [, iv, tag, body] = stored.sealed.split('.');
  for (const key of openingKeys()) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8'));
    } catch {
      // try the next key
    }
  }
  // Data restored without its key: say so plainly, and never quietly hand out new links in its place.
  throw new Error(`The deals' secret links can't be opened: they were sealed with another key. Restore ${KEYRING} or set the POD_KEY_SECRET they were sealed with (nothing was overwritten).`);
}

// One process writes the data file. A second one (two servers on one folder) would each keep its own
// per-deal queue, so two captures could race: the second refuses to write instead.
const LOCK = path.join(DATA_DIR, '.writer.pid');
let ownLock = false;
function claimWriter() {
  if (ownLock) return;
  try {
    fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
  } catch {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    let alive = false;
    try {
      alive = pid > 0 && pid !== process.pid && process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`Another process (pid ${pid}) is writing ${DATA_DIR}. Run one server per data folder.`);
    fs.writeFileSync(LOCK, String(process.pid));
  }
  ownLock = true;
}

function load(): DbShape {
  let raw: string;
  try {
    raw = fs.readFileSync(DB_FILE, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { milestones: [] };
    throw error;
  }
  // A file we can't parse is an error, not an empty store: treating it as empty would let the next
  // write replace every milestone with just one.
  let db: DbShape;
  try {
    db = JSON.parse(raw) as DbShape;
  } catch {
    throw new Error(`${DB_FILE} is not valid JSON; fix or move it before continuing (nothing was overwritten).`);
  }
  // Deals saved before the timeline was chained get their links here; sealed steps are never redone.
  db.milestones.forEach(sealTimeline);
  for (const m of db.milestones) m.access = openAccess(m.access as MilestoneAccess | SealedAccess | undefined);
  return db;
}

function save(db: DbShape) {
  claimWriter();
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  const onDisk = { ...db, milestones: db.milestones.map((m) => (m.access ? { ...m, access: sealAccess(m.access) } : m)) };
  fs.writeFileSync(tmp, JSON.stringify(onDisk, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
// Strictly increasing, so what happened later always sorts later, even within one millisecond
// (a review started after the terms changed, an overdue notice after a new deadline).
let lastMs = 0;
export const nowIso = () => new Date((lastMs = Math.max(Date.now(), lastMs + 1))).toISOString();

export function listMilestones(): Milestone[] {
  return load().milestones.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getMilestone(id: string): Milestone | undefined {
  return load().milestones.find((m) => m.id === id);
}

export function insertMilestone(m: Milestone): Milestone {
  sealTimeline(m);
  const db = load();
  db.milestones.push(m);
  save(db);
  return m;
}

/** Read-modify-write a single milestone. The mutation runs against a fresh copy from disk. */
export function updateMilestone(id: string, mutate: (m: Milestone) => void): Milestone {
  const db = load();
  const m = db.milestones.find((x) => x.id === id);
  if (!m) throw new Error(`Milestone ${id} not found`);
  mutate(m);
  // An offer of new terms only stands while the terms can still change (not under review, paid or cancelled).
  if (m.termsChange && !['awaiting_funding', 'funded', 'changes_requested', 'escalated'].includes(m.status)) m.termsChange = undefined;
  sealTimeline(m);
  m.updatedAt = nowIso();
  save(db);
  return m;
}

export function pushEvent(m: Milestone, actor: TimelineEvent['actor'], type: string, text: string) {
  m.timeline.push({ at: nowIso(), actor, type, text });
}

/** Remove the milestones that match (and their uploaded files). Returns how many went. */
export function deleteWhere(match: (m: Milestone) => boolean): number {
  const db = load();
  const gone = db.milestones.filter(match);
  if (!gone.length) return 0;
  db.milestones = db.milestones.filter((m) => !match(m));
  save(db);
  for (const m of gone) fs.rmSync(path.join(UPLOAD_DIR, m.id), { recursive: true, force: true });
  return gone.length;
}

export function deleteAll() {
  save({ milestones: [] });
}
