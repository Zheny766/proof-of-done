import 'server-only';
// A small JSON-file store. It keeps the demo dependency-free and easy for judges to run; a real
// deployment would put this behind Postgres. Writes are atomic (temp file + rename).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Milestone, TimelineEvent } from './types';

const DATA_DIR = process.env.POD_DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'milestones.json');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

type DbShape = { milestones: Milestone[] };

function load(): DbShape {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as DbShape;
  } catch {
    return { milestones: [] };
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

export function deleteAll() {
  save({ milestones: [] });
}
