// Saves deals that ran on the real PayPal sandbox into demo/sandbox-runs/, for the /sandbox page.
// Usage: node --conditions=react-server scripts/export-sandbox-run.ts <data dir> <milestone id>...
// Only the public part is kept (see lib/escrow/sandbox-runs.ts): PayPal ids, debug ids, verdicts, steps.

import fs from 'node:fs';
import path from 'node:path';
import { publicRun } from '../lib/escrow/sandbox-runs.ts';
import type { Milestone } from '../lib/escrow/types.ts';

const [dataDir, ...ids] = process.argv.slice(2);
if (!dataDir || !ids.length) {
  console.error('Usage: scripts/export-sandbox-run.ts <data dir> <milestone id>...');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'milestones.json'), 'utf8'));
const all: Milestone[] = Array.isArray(raw) ? raw : (raw.milestones ?? Object.values(raw));
const out = path.join(import.meta.dirname, '..', 'demo', 'sandbox-runs');
fs.mkdirSync(out, { recursive: true });
for (const id of ids) {
  const m = all.find((x) => x.id === id);
  if (!m) throw new Error(`No milestone ${id} in ${dataDir}`);
  const run = publicRun(m);
  fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(run, null, 2) + '\n');
  console.log(`${id}: ${run.title}, ${run.status}, ${run.calls.length} PayPal calls -> demo/sandbox-runs/${id}.json`);
}
