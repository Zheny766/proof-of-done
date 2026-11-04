// The proof bench: what the evaluation runs in eval/results show, counted from the files themselves so the
// site can't drift from them. For each set: how many deliveries were rigged or wrong, how many of those the
// reviewer on its own went to pay (it called release, so the second opinion was asked), how many were
// actually paid, and how much honest work was held back.
import haiku from '@/eval/results/claude-haiku-5-5.json';
import opus from '@/eval/results/claude-opus-5-5.json';
import arena from '@/eval/results/arena-haiku.json';

type EvalCase = { id: string; expect: string; outcome: string; secondOpinion: string };
type ArenaCase = { paidByAI: boolean; secondOpinion: string };

export type BenchRow = {
  set: string;
  reviewer: string;
  cases: number;
  bad: number;
  honest: number;
  /** Rigged or wrong deliveries the reviewer alone tried to pay. */
  aloneWouldPay: number;
  /** Rigged or wrong deliveries that were paid with the independent check in place. */
  paid: number;
  honestHeld: number;
};

const fromEval = (set: string, reviewer: string, rows: EvalCase[]): BenchRow => {
  const bad = rows.filter((r) => r.expect !== 'release');
  const honest = rows.filter((r) => r.expect === 'release');
  return {
    set,
    reviewer,
    cases: rows.length,
    bad: bad.length,
    honest: honest.length,
    aloneWouldPay: bad.filter((r) => r.secondOpinion !== 'not asked').length,
    paid: bad.filter((r) => r.outcome === 'released').length,
    honestHeld: honest.filter((r) => r.outcome !== 'released').length,
  };
};

export const benchRows = (): BenchRow[] => {
  const tricks = arena.results as ArenaCase[];
  return [
    fromEval('Test deliveries with known answers', 'Claude Haiku 5.5', haiku.results as EvalCase[]),
    fromEval('The key cases again', 'Claude Opus 5.5', opus.results as EvalCase[]),
    {
      set: 'Live tricks in “Try to fool it”',
      reviewer: 'Claude Haiku 5.5',
      cases: tricks.length,
      bad: tricks.length,
      honest: 0,
      aloneWouldPay: tricks.filter((r) => r.secondOpinion !== 'not asked').length,
      paid: tricks.filter((r) => r.paidByAI).length,
      honestHeld: 0,
    },
  ];
};
