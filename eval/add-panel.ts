// Asks Gemini for its check on each recorded demo delivery and stores the answer in the replay, so
// the demos show the whole panel. Gemini gets exactly what the recorded second opinion had: the
// delivery's notes and files, the reviewer's findings and summary. Only replays where a second
// opinion was asked (a release was attempted) get one. Needs GEMINI_API_KEY.
//
//   node --env-file=.env.local --conditions=react-server eval/add-panel.ts [case ...]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CriterionFinding, Milestone, Submission } from '../lib/escrow/types.ts';

process.env.POD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-panel-'));
const { runGeminiAudit } = await import('../lib/escrow/gemini.ts');
const { sniffType } = await import('../lib/escrow/evidence.ts');
const { UPLOAD_DIR } = await import('../lib/escrow/store.ts');

const here = path.dirname(new URL(import.meta.url).pathname);
const replays = path.join(here, '..', 'demo', 'replays');
const filesDir = path.join(here, '..', 'demo', 'files');
const only = process.argv.slice(2);

for (const file of fs.readdirSync(replays).filter((f) => f.endsWith('.json'))) {
  const id = file.replace(/\.json$/, '');
  if (only.length && !only.includes(id)) continue;
  const replay = JSON.parse(fs.readFileSync(path.join(replays, file), 'utf8'));
  if (!replay.audit) {
    console.log(`${id}: no second opinion was asked in this run, skipped`);
    continue;
  }
  const criteria = (replay.milestone.criteria as (string | { text: string; judge: 'client' })[]).map((c, i) =>
    typeof c === 'string' ? { id: `c${i + 1}`, text: c } : { id: `c${i + 1}`, text: c.text, judge: c.judge },
  );
  const m = { id: `ms_demo_${id}`, title: replay.milestone.title, description: replay.milestone.description, criteria, amount: '100.00', currency: 'USD' } as Milestone;
  const attachments = (replay.files as string[]).map((name, i) => {
    const bytes = fs.readFileSync(path.join(filesDir, name));
    const rel = path.join(m.id, `${i}_${name}`);
    fs.mkdirSync(path.join(UPLOAD_DIR, m.id), { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, rel), bytes);
    return { id: `att${i}`, name, mime: sniffType(bytes, ''), size: bytes.length, file: rel };
  });
  const s = { id: 'sub_demo', at: replay.recordedAt, notes: replay.notes, links: [], attachments } as Submission;
  const findings = (replay.steps as { kind: string; finding?: CriterionFinding }[]).filter((x) => x.kind === 'finding').map((x) => x.finding!);
  const audit = await runGeminiAudit(m, s, { findings, summary: replay.summary, pages: [] });
  replay.panel = [{ ...audit, recordedAt: new Date().toISOString() }];
  fs.writeFileSync(path.join(replays, file), `${JSON.stringify(replay, null, 2)}\n`);
  console.log(`${id}: ${audit.model} ${audit.agreed ? 'confirmed' : 'refused'} | ${audit.summary.slice(0, 120)} | red flags ${audit.redFlags.length} | tokens ${audit.usage?.inputTokens}/${audit.usage?.outputTokens}`);
}
