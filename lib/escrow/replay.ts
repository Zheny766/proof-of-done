import 'server-only';
// The hosted demo's AI reviews: real Claude runs recorded with `eval/run.ts --replays demo/replays`,
// played back through the same hooks as a live review, so the money moves the same way and nobody
// pays for the API while judges click around.

import fs from 'node:fs';
import path from 'node:path';
import type { ReviewHooks, ReviewOutcome } from './reviewer.ts';
import type { AgentLogEntry, Audit, CriterionFinding, ReviewDecision } from './types.ts';

export interface Replay {
  recordedAt: string;
  model: string;
  case: string;
  milestone: { title: string; description: string; criteria: (string | { text: string; judge: 'client' })[] };
  notes: string;
  files: string[];
  steps: { at: number; kind: string; text?: string; finding?: CriterionFinding }[];
  audit?: Audit;
  /** Further checks recorded on the same delivery (Gemini's answer to exactly this material). */
  panel?: Audit[];
  decision: ReviewDecision;
  summary: string;
  feedback?: string;
  ms: number;
  usage?: { inputTokens: number; outputTokens: number };
}

const DEMO_DIR = path.join(process.cwd(), 'demo');

export function loadReplay(scenario: string): Replay | null {
  if (!/^[a-z-]+$/.test(scenario)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(DEMO_DIR, 'replays', `${scenario}.json`), 'utf8')) as Replay;
  } catch {
    return null;
  }
}

export const demoFile = (name: string) => fs.readFileSync(path.join(DEMO_DIR, 'files', path.basename(name)));

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
// "claude-opus-5-5" -> "Claude Opus 5.5"
const modelName = (id: string) => `Claude ${id.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^\w/, (c) => c.toUpperCase())}`;

/** Plays a recorded review back at its own pace (a little faster), then makes its decision for real. */
export async function runReplayReview(replay: Replay, hooks: ReviewHooks & { setAudit: (a: Audit, panel?: Audit[]) => void }, speed = 1.4): Promise<ReviewOutcome> {
  // Tests set POD_SIM_STEP_MS=0: no waiting.
  const scale = process.env.POD_SIM_STEP_MS === '0' ? 0 : 1 / speed;
  const start = Date.now();
  hooks.log({ kind: 'info', text: `Replay of a real ${modelName(replay.model)} review recorded on ${day(replay.recordedAt)}. Create your own deal to run one live.` });
  for (const step of replay.steps) {
    const wait = start + step.at * scale - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (step.kind === 'finding') {
      if (step.finding) hooks.finding(step.finding);
      continue;
    }
    if (!step.text) continue;
    if (/^Second opinion/.test(step.text) && replay.audit) hooks.setAudit(replay.audit, replay.panel);
    if (step.kind === 'decision') {
      if (replay.decision === 'release') await hooks.release(replay.summary);
      else if (replay.decision === 'request_changes') await hooks.requestChanges(replay.feedback ?? replay.summary, replay.summary);
      else await hooks.escalate(replay.feedback ?? replay.summary, replay.summary);
    }
    hooks.log({ kind: step.kind as AgentLogEntry['kind'], text: step.text });
  }
  return { decision: replay.decision, summary: replay.summary, usage: replay.usage };
}
