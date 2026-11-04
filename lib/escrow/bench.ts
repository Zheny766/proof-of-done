// The proof bench: what the evaluation runs in eval/results show, counted from the files themselves so the
// site can't drift from them. For each reviewer: how many deliveries were rigged or wrong, how many of
// those the reviewer on its own went to pay (it called release, so the independent checks were asked),
// how many were actually paid with the checks in place, and how much honest work was held back.
import haiku from '@/eval/results/claude-haiku-5-5.json';
import opus from '@/eval/results/claude-opus-5-5.json';
import arena from '@/eval/results/arena-haiku.json';
import forged from '@/eval/results/forged-claude-haiku-5-5.json';

type EvalCase = { id: string; kind: string; expect: string; outcome: string; reviewerTriedToPay?: boolean; secondOpinion: string };
type ArenaCase = { paidByAI: boolean; secondOpinion: string };

export type BenchRow = {
  set: string;
  reviewer: string;
  checks: string;
  cases: number;
  bad: number;
  honest: number;
  /** Rigged or wrong deliveries the reviewer alone went to pay. */
  aloneWouldPay: number;
  /** Rigged or wrong deliveries that were paid with the independent checks in place. */
  paid: number;
  honestHeld: number;
  /** The honest deliveries that were held, by case id. */
  heldIds: string[];
};

const fromEval = (set: string, reviewer: string, checks: string, rows: EvalCase[]): BenchRow => {
  const bad = rows.filter((r) => r.expect !== 'release');
  const honest = rows.filter((r) => r.expect === 'release');
  const held = honest.filter((r) => r.outcome !== 'released');
  return {
    set,
    reviewer,
    checks,
    cases: rows.length,
    bad: bad.length,
    honest: honest.length,
    aloneWouldPay: bad.filter((r) => r.reviewerTriedToPay ?? r.secondOpinion !== 'not asked').length,
    paid: bad.filter((r) => r.outcome === 'released').length,
    honestHeld: held.length,
    heldIds: held.map((r) => r.id),
  };
};

export const benchRows = (): BenchRow[] => {
  const tricks = arena.results as ArenaCase[];
  return [
    fromEval('Deliveries with known answers', 'Claude Opus 5.5', 'Claude Haiku 5.5 + Gemini', opus.results as EvalCase[]),
    fromEval('Deliveries with known answers', 'Claude Haiku 5.5', 'Claude Sonnet 5.5 + Gemini', haiku.results as EvalCase[]),
    {
      set: 'Live tricks in “Try to fool it”',
      reviewer: 'Claude Haiku 5.5',
      checks: 'second opinion',
      cases: tricks.length,
      bad: tricks.length,
      honest: 0,
      aloneWouldPay: tricks.filter((r) => r.secondOpinion !== 'not asked').length,
      paid: tricks.filter((r) => r.paidByAI).length,
      honestHeld: 0,
      heldIds: [],
    },
  ];
};

/** The reviewer fooled completely (every criterion "met"): what each independent check caught on its own. */
export const forgedBench = () => {
  const s = forged.summary;
  const pair = (x: string) => x.split('/').map(Number) as [number, number];
  return {
    second: { model: s.auditModel, caught: pair(s.secondOpinionCaught), confirmed: pair(s.secondOpinionConfirmedHonest) },
    gemini: { caught: pair(s.geminiCaught), confirmed: pair(s.geminiConfirmedHonest) },
    bothMissed: s.bothMissed as string[],
  };
};
