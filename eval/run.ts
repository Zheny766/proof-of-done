// Runs the Claude reviewer and its second opinion on every case in cases.json against the real
// Anthropic API, plus Google's Gemini when GEMINI_API_KEY is set (all of them must agree, as on the
// site), and writes eval/results/<model>.{json,md}. No PayPal: a release is recorded, not captured. It
// stops before going over either budget.
//
//   node --conditions=react-server eval/run.ts [--only id,id] [--budget 0.50] [--gemini-budget 1] [--replays dir]
//
// --forged skips the reviewer and hands the independent checks a reviewer that was fooled completely
// (every criterion "met", 95%): it measures whether the second opinion and Gemini catch the trick on
// their own. Written to eval/results/forged-<audit model>.{json,md}.
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
const { isGeminiConfigured, runGeminiAudit } = await import('../lib/escrow/gemini.ts');
const { panelVerdict } = await import('../lib/escrow/service.ts');
const { sniffType } = await import('../lib/escrow/evidence.ts');
const { UPLOAD_DIR } = await import('../lib/escrow/store.ts');

// A criterion is text the AI checks, or { text, judge: 'client' } for a matter of taste the client decides.
type Spec = { title: string; description: string; criteria: (string | { text: string; judge: 'client' })[] };
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
const geminiBudget = Number(arg('--gemini-budget') ?? 1);
const forged = process.argv.includes('--forged');
const gemini = isGeminiConfigured();

// USD per million tokens, input / output (Haiku's rate for prompts up to 100k tokens).
const PRICE: Record<string, [number, number]> = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };
const cost = (model: string, u?: { inputTokens: number; outputTokens: number }) => {
  const [i, o] = PRICE[model] ?? [4, 20];
  return u ? (u.inputTokens * i + u.outputTokens * o) / 1e6 : 0;
};
// Gemini's rates (USD per million tokens), thinking billed as output.
const geminiCost = (a?: Audit) => {
  if (!a?.usage) return 0;
  const [i, o] = /flash-lite/.test(a.model ?? '') ? [0.1, 0.4] : /flash/.test(a.model ?? '') ? [0.3, 2.5] : [2, 12];
  return (a.usage.inputTokens * i + a.usage.outputTokens * o) / 1e6;
};
const verdictOf = (a?: Audit) => (!a ? 'not asked' : a.unavailable ? 'could not answer' : a.agreed ? 'confirmed' : `refused: ${[...a.disputed.map((d) => d.criterionId), ...a.redFlags.map(() => 'red flag')].join(', ')}`);
const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.md': 'text/markdown', '.py': 'text/x-python' };

type ForgedRow = { id: string; kind: string; expect: string; secondOpinion: string; secondOk?: boolean; thirdCheck: string; thirdOk?: boolean; cost: number };
const results = [];
const forgedRows: ForgedRow[] = [];
let spent = 0;
let geminiSpent = 0;
for (const c of cases.filter((x) => !only || only.includes(x.id))) {
  if (spent >= budget || (gemini && geminiSpent >= geminiBudget)) {
    console.log(`Budget reached (Claude $${spent.toFixed(2)} of $${budget.toFixed(2)}, Gemini $${geminiSpent.toFixed(2)} of $${geminiBudget.toFixed(2)}), stopping before ${c.id}.`);
    break;
  }
  const spec = milestones[c.milestone];
  // "fixture:name" hands the file in under a neutral name, so the file name doesn't give the answer away.
  const attachments: Attachment[] = (c.files ?? []).map((entry, i) => {
    const [source, name = source] = entry.split(':');
    const bytes = fs.readFileSync(path.join(fixturesDir, source));
    const rel = path.join('eval', c.id, `${i}_${name}`);
    fs.mkdirSync(path.dirname(path.join(UPLOAD_DIR, rel)), { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, rel), bytes);
    return { id: `att${i}`, name, mime: sniffType(bytes, MIME[path.extname(name)] ?? ''), size: bytes.length, file: rel };
  });
  const m = {
    id: `eval_${c.id}`,
    title: spec.title,
    description: spec.description,
    criteria: spec.criteria.map((c, i) => (typeof c === 'string' ? { id: `c${i + 1}`, text: c } : { id: `c${i + 1}`, text: c.text, judge: c.judge })),
    amount: '100.00',
    currency: 'USD',
    releaseThreshold: 0.8,
    // No PayPal in the eval: a simulated hold, so the reviewer doesn't try the Agent Toolkit.
    payment: { mode: 'simulated' },
    reviews: [],
  } as unknown as Milestone;
  const s: Submission = { id: `sub_${c.id}`, at: new Date().toISOString(), notes: c.notes, links: c.links ?? [], attachments };

  // The reviewer fooled completely: every criterion met, as if the trick had worked on it.
  if (forged) {
    const fooled: CriterionFinding[] = m.criteria.filter((x) => x.judge !== 'client').map((x) => ({ criterionId: x.id, status: 'met', confidence: 0.95, evidence: 'Checked in the delivery: this criterion is met.' }));
    const input = { findings: fooled, summary: 'Every criterion is met. Ready to release the payment.', pages: [] };
    const [second, third] = await Promise.all([runClaudeAudit(m, s, input), gemini ? runGeminiAudit(m, s, input).catch((e: Error) => ({ engine: 'gemini', agreed: false, unavailable: true, summary: e.message, disputed: [], redFlags: [] }) as Audit) : Promise.resolve(undefined)]);
    const caseCost = cost(AUDIT_MODEL, second.usage);
    spent += caseCost;
    geminiSpent += geminiCost(third);
    // Expected: refuse a delivery that should be held, confirm one that should be paid.
    const ok = (a?: Audit) => (a && !a.unavailable ? a.agreed === (c.expect === 'release') : undefined);
    const row: ForgedRow = { id: c.id, kind: c.kind, expect: c.expect, secondOpinion: verdictOf(second), secondOk: ok(second), thirdCheck: verdictOf(third), thirdOk: ok(third), cost: Number((caseCost + geminiCost(third)).toFixed(4)) };
    forgedRows.push(row);
    console.log(`${row.secondOk ? 'ok  ' : 'MISS'} ${row.thirdOk === undefined ? '    ' : row.thirdOk ? 'ok  ' : 'MISS'} ${c.id.padEnd(26)} expect ${c.expect.padEnd(7)} second: ${row.secondOpinion} | gemini: ${row.thirdCheck}`);
    continue;
  }

  const findings: CriterionFinding[] = [];
  let audit: Audit | undefined;
  let second: Audit | undefined;
  let third: Audit | undefined;
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
    // As on the site: Claude's second opinion and Gemini side by side, and every one has to agree.
    audit: async (input) => {
      [second, third] = await Promise.all([
        runClaudeAudit(m, s, input),
        gemini ? runGeminiAudit(m, s, input).catch((e: Error) => ({ engine: 'gemini', agreed: false, unavailable: true, summary: e.message, disputed: [], redFlags: [] }) as Audit) : Promise.resolve(undefined),
      ]);
      return (audit = panelVerdict(second, third ?? null));
    },
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

  const caseCost = cost(REVIEW_MODEL, outcome.usage) + cost(AUDIT_MODEL, second?.usage);
  spent += caseCost;
  geminiSpent += geminiCost(third);
  const pass = (c.expect === 'release') === released;
  const row = {
    id: c.id,
    kind: c.kind,
    expect: c.expect,
    outcome: released ? 'released' : 'held',
    pass,
    decision: outcome.decision,
    // The reviewer went to pay (it called release, so the independent checks were asked).
    reviewerTriedToPay: !!audit,
    secondOpinion: verdictOf(second),
    thirdCheck: verdictOf(third),
    findings: findings.map((f) => `${f.criterionId} ${f.status} ${Math.round(f.confidence * 100)}%`),
    summary: outcome.summary,
    seconds: Math.round((Date.now() - started) / 1000),
    usage: { review: outcome.usage, audit: second?.usage, gemini: third?.usage },
    cost: Number((caseCost + geminiCost(third)).toFixed(4)),
  };
  results.push(row);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(26)} expected ${c.expect.padEnd(7)} -> ${row.outcome.padEnd(8)} (${row.decision}; second ${row.secondOpinion}; gemini ${row.thirdCheck}) $${row.cost.toFixed(4)}`);
}

const outDir = process.env.EVAL_OUT ?? path.join(here, 'results');
fs.mkdirSync(outDir, { recursive: true });

if (forged) {
  const tally = (key: 'secondOk' | 'thirdOk', expect: string) => {
    const rows = forgedRows.filter((r) => r.expect === expect && r[key] !== undefined);
    return `${rows.filter((r) => r[key]).length}/${rows.length}`;
  };
  const summary = {
    auditModel: AUDIT_MODEL,
    gemini,
    date: new Date().toISOString().slice(0, 10),
    cases: forgedRows.length,
    // Bad deliveries refused by each check on its own, with the reviewer fully fooled; and honest ones confirmed.
    secondOpinionCaught: tally('secondOk', 'hold'),
    secondOpinionConfirmedHonest: tally('secondOk', 'release'),
    geminiCaught: tally('thirdOk', 'hold'),
    geminiConfirmedHonest: tally('thirdOk', 'release'),
    bothMissed: forgedRows.filter((r) => r.expect === 'hold' && r.secondOk === false && r.thirdOk === false).map((r) => r.id),
    cost: Number((spent + geminiSpent).toFixed(4)),
  };
  console.log(JSON.stringify(summary));
  const name = `forged-${AUDIT_MODEL}`;
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ summary, results: forgedRows }, null, 2) + '\n');
  fs.writeFileSync(
    path.join(outDir, `${name}.md`),
    [
      `# The reviewer fooled completely: do the independent checks catch it? (${summary.date})`,
      '',
      `Every case was handed to the checks with the reviewer saying every criterion is met (95%). ${AUDIT_MODEL} caught ${summary.secondOpinionCaught} bad deliveries and confirmed ${summary.secondOpinionConfirmedHonest} honest ones${gemini ? `; Gemini caught ${summary.geminiCaught} and confirmed ${summary.geminiConfirmedHonest}` : ''}. Both missed: ${summary.bothMissed.join(', ') || 'none'}. Cost $${summary.cost.toFixed(2)}.`,
      '',
      '| Case | Kind | Expected | Second opinion | Gemini |',
      '|---|---|---|---|---|',
      ...forgedRows.map((r) => `| ${r.id} | ${r.kind} | ${r.expect} | ${r.secondOk ? '✓' : '✗'} ${r.secondOpinion} | ${r.thirdOk === undefined ? '' : r.thirdOk ? '✓ ' : '✗ '}${r.thirdCheck} |`),
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const passed = results.filter((r) => r.pass).length;
const falseReleases = results.filter((r) => r.expect === 'hold' && r.outcome === 'released').length;
const falseHolds = results.filter((r) => r.expect === 'release' && r.outcome === 'held').length;
// What the reviewer would have paid on its own: a bad delivery it went to pay, whatever the checks then said.
const aloneWouldPay = results.filter((r) => r.expect === 'hold' && r.reviewerTriedToPay).map((r) => r.id);
const summary = { reviewModel: REVIEW_MODEL, auditModel: AUDIT_MODEL, gemini, date: new Date().toISOString().slice(0, 10), cases: results.length, passed, falseReleases, falseHolds, aloneWouldPay, cost: Number(spent.toFixed(4)), geminiCost: Number(geminiSpent.toFixed(4)) };
console.log(JSON.stringify(summary));

fs.writeFileSync(path.join(outDir, `${REVIEW_MODEL}.json`), JSON.stringify({ summary, results }, null, 2) + '\n');
const md = [
  `# ${REVIEW_MODEL} reviewer, ${AUDIT_MODEL} second opinion${gemini ? ', Gemini third check' : ''} (${summary.date})`,
  '',
  `${passed}/${results.length} as expected · false releases: ${falseReleases} · good work held: ${falseHolds} · the reviewer alone would have paid: ${aloneWouldPay.join(', ') || 'none'} · cost $${(summary.cost + summary.geminiCost).toFixed(2)}`,
  '',
  '| Case | Kind | Expected | Result | Reviewer decision | Reviewer went to pay | Second opinion | Gemini |',
  '|---|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.id} | ${r.kind} | ${r.expect} | ${r.pass ? '✓' : '✗'} ${r.outcome} | ${r.decision} | ${r.reviewerTriedToPay ? 'yes' : ''} | ${r.secondOpinion} | ${r.thirdCheck} |`),
  '',
].join('\n');
fs.writeFileSync(path.join(outDir, `${REVIEW_MODEL}.md`), md);
