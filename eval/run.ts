// Runs the Claude reviewer and its second opinion on every case in cases.json against the real
// Anthropic API and writes eval/results/<model>.{json,md}. No PayPal: a release is recorded, not
// captured. It stops before going over the budget.
//
//   node --conditions=react-server eval/run.ts [--only id,id] [--budget 0.50] [--replays dir]
//
// --replays writes each case's full review (log with timings, findings, second opinion) to
// <dir>/<case>.json; the hosted demo plays those back instead of calling the API.
//
// POD_REVIEW_MODEL / POD_AUDIT_MODEL pick the models (defaults: claude-opus-5-5 / claude-haiku-5-5).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Audit, Attachment, CriterionFinding, Milestone, Submission } from '../lib/escrow/types.ts';

process.env.POD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-eval-'));
const { REVIEW_MODEL, AUDIT_MODEL, runClaudeAudit, runClaudeReview } = await import('../lib/escrow/reviewer.ts');
const { sniffType } = await import('../lib/escrow/evidence.ts');
const { UPLOAD_DIR } = await import('../lib/escrow/store.ts');

type Spec = { title: string; description: string; criteria: string[] };
type Case = { id: string; milestone: string; kind: string; expect: 'release' | 'hold'; notes: string; files?: string[]; links?: string[] };
const here = path.dirname(new URL(import.meta.url).pathname);
// EVAL_CASES / EVAL_FIXTURES / EVAL_OUT point a one-off run elsewhere without touching the committed results.
const casesFile = process.env.EVAL_CASES ?? path.join(here, 'cases.json');
const fixturesDir = process.env.EVAL_FIXTURES ?? path.join(here, 'fixtures');
const { milestones, cases } = JSON.parse(fs.readFileSync(casesFile, 'utf8')) as { milestones: Record<string, Spec>; cases: Case[] };

const arg = (name: string) => process.argv.find((a, i) => process.argv[i - 1] === name);
const only = arg('--only')?.split(',');
const budget = Number(arg('--budget') ?? 0.5);
const replayDir = arg('--replays');

// USD per million tokens, input / output (Haiku's rate for prompts up to 100k tokens).
const PRICE: Record<string, [number, number]> = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };
const cost = (model: string, u?: { inputTokens: number; outputTokens: number }) => {
  const [i, o] = PRICE[model] ?? [4, 20];
  return u ? (u.inputTokens * i + u.outputTokens * o) / 1e6 : 0;
};
const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.md': 'text/markdown', '.py': 'text/x-python' };

const results = [];
let spent = 0;
for (const c of cases.filter((x) => !only || only.includes(x.id))) {
  if (spent >= budget) {
    console.log(`Budget of $${budget.toFixed(2)} reached, stopping before ${c.id}.`);
    break;
  }
  const spec = milestones[c.milestone];
  const attachments: Attachment[] = (c.files ?? []).map((name, i) => {
    const bytes = fs.readFileSync(path.join(fixturesDir, name));
    const rel = path.join('eval', c.id, `${i}_${name}`);
    fs.mkdirSync(path.dirname(path.join(UPLOAD_DIR, rel)), { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, rel), bytes);
    return { id: `att${i}`, name, mime: sniffType(bytes, MIME[path.extname(name)] ?? ''), size: bytes.length, file: rel };
  });
  const m = {
    id: `eval_${c.id}`,
    title: spec.title,
    description: spec.description,
    criteria: spec.criteria.map((text, i) => ({ id: `c${i + 1}`, text })),
    amount: '100.00',
    currency: 'USD',
    releaseThreshold: 0.8,
    // No PayPal in the eval: a simulated hold, so the reviewer doesn't try the Agent Toolkit.
    payment: { mode: 'simulated' },
    reviews: [],
  } as unknown as Milestone;
  const s: Submission = { id: `sub_${c.id}`, at: new Date().toISOString(), notes: c.notes, links: c.links ?? [], attachments };

  const findings: CriterionFinding[] = [];
  let audit: Audit | undefined;
  let released = false;
  let feedback: string | undefined;
  const started = Date.now();
  const at = () => Date.now() - started;
  const steps: { at: number; kind: string; text?: string; finding?: CriterionFinding }[] = [];
  const outcome = await runClaudeReview(m, s, {
    log: (e) => void steps.push({ at: at(), kind: e.kind, text: e.text }),
    finding: (f) => {
      findings.push(f);
      steps.push({ at: at(), kind: 'finding', finding: f });
    },
    audit: async (input) => (audit = await runClaudeAudit(m, s, input)),
    release: async () => {
      released = true;
      return {};
    },
    requestChanges: async (fb) => void (feedback = fb),
    escalate: async (reason) => void (feedback = reason),
  }).catch((error: Error) => ({ decision: 'error' as const, summary: error.message, usage: undefined }));
  if (replayDir) {
    fs.mkdirSync(replayDir, { recursive: true });
    const replay = { recordedAt: new Date().toISOString(), model: REVIEW_MODEL, case: c.id, milestone: spec, notes: c.notes, files: c.files ?? [], steps, audit, decision: outcome.decision, summary: outcome.summary, feedback, released, ms: at(), usage: outcome.usage };
    fs.writeFileSync(path.join(replayDir, `${c.id}.json`), JSON.stringify(replay, null, 2) + '\n');
  }

  const caseCost = cost(REVIEW_MODEL, outcome.usage) + cost(AUDIT_MODEL, audit?.usage);
  spent += caseCost;
  const pass = (c.expect === 'release') === released;
  const row = {
    id: c.id,
    kind: c.kind,
    expect: c.expect,
    outcome: released ? 'released' : 'held',
    pass,
    decision: outcome.decision,
    secondOpinion: audit ? (audit.agreed ? 'confirmed' : `refused: ${[...audit.disputed.map((d) => d.criterionId), ...audit.redFlags.map(() => 'red flag')].join(', ')}`) : 'not asked',
    findings: findings.map((f) => `${f.criterionId} ${f.status} ${Math.round(f.confidence * 100)}%`),
    summary: outcome.summary,
    seconds: Math.round((Date.now() - started) / 1000),
    usage: { review: outcome.usage, audit: audit?.usage },
    cost: Number(caseCost.toFixed(4)),
  };
  results.push(row);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(22)} expected ${c.expect.padEnd(7)} -> ${row.outcome.padEnd(8)} (${row.decision}; second opinion ${row.secondOpinion}) $${caseCost.toFixed(4)}`);
}

const passed = results.filter((r) => r.pass).length;
const falseReleases = results.filter((r) => r.expect === 'hold' && r.outcome === 'released').length;
const falseHolds = results.filter((r) => r.expect === 'release' && r.outcome === 'held').length;
const summary = { reviewModel: REVIEW_MODEL, auditModel: AUDIT_MODEL, date: new Date().toISOString().slice(0, 10), cases: results.length, passed, falseReleases, falseHolds, cost: Number(spent.toFixed(4)) };
console.log(JSON.stringify(summary));

const outDir = process.env.EVAL_OUT ?? path.join(here, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${REVIEW_MODEL}.json`), JSON.stringify({ summary, results }, null, 2) + '\n');
const md = [
  `# ${REVIEW_MODEL} reviewer, ${AUDIT_MODEL} second opinion (${summary.date})`,
  '',
  `${passed}/${results.length} as expected · false releases: ${falseReleases} · good work held: ${falseHolds} · cost $${summary.cost.toFixed(2)}`,
  '',
  '| Case | Kind | Expected | Result | Reviewer decision | Second opinion |',
  '|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.id} | ${r.kind} | ${r.expect} | ${r.pass ? '✓' : '✗'} ${r.outcome} | ${r.decision} | ${r.secondOpinion} |`),
  '',
].join('\n');
fs.writeFileSync(path.join(outDir, `${REVIEW_MODEL}.md`), md);
