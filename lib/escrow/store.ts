import 'server-only';
// JSON file instead of a database so the project runs with zero setup. Writes go to a temp file
// and get renamed, so a crash can't leave half a file.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Milestone, TimelineEvent } from './types.ts';

const DATA_DIR = process.env.POD_DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'milestones.json');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

type DbShape = { milestones: Milestone[] };

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
  try {
    return JSON.parse(raw) as DbShape;
  } catch {
    throw new Error(`${DB_FILE} is not valid JSON; fix or move it before continuing (nothing was overwritten).`);
  }
}

function save(db: DbShape) {
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
export const nowIso = () => new Date().toISOString();

export function listMilestones(): Milestone[] {
  return load().milestones.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getMilestone(id: string): Milestone | undefined {
  return load().milestones.find((m) => m.id === id);
}

export function insertMilestone(m: Milestone): Milestone {
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
