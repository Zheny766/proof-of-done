'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

// The home page's Proof Engine: two recorded demo runs played back step by step, so a visitor sees
// the money held, the three AI checks decide, and the money released or stopped. Every status here
// is what happened in those runs (demo/replays/honest.json and cheater.json): Claude Opus reviewed,
// Claude Haiku gave the second opinion, Gemini the third. It alternates between the two on its own;
// the tabs pick one. With reduced motion each run shows its end at once and nothing cycles.

type Tone = 'ok' | 'warn' | 'bad';
type Check = { n: string; who: string; role: string; result: string; tone: Tone };
type Run = { key: string; tab: string; title: string; checks: Check[]; outcome: { title: string; line: string; tone: 'ok' | 'bad' } };

const RUNS: Run[] = [
  {
    key: 'honest',
    tab: 'Honest work',
    title: 'Menu redesign for a cafe',
    checks: [
      { n: '01', who: 'Claude Opus', role: 'reviews every criterion', result: 'Verified 3/3', tone: 'ok' },
      { n: '02', who: 'Claude Haiku', role: 'second opinion', result: 'Confirmed', tone: 'ok' },
      { n: '03', who: 'Gemini', role: 'Google · third check', result: 'Confirmed', tone: 'ok' },
    ],
    outcome: { title: 'Payment released', line: 'All verification gates passed · PayPal captured and paid out', tone: 'ok' },
  },
  {
    key: 'cheater',
    tab: 'A cheater',
    title: 'Winter menu for a cafe',
    checks: [
      { n: '01', who: 'Claude Opus', role: 'reviews every criterion', result: 'Tried to pay', tone: 'warn' },
      { n: '02', who: 'Claude Haiku', role: 'second opinion', result: 'Refused: red flag', tone: 'bad' },
      { n: '03', who: 'Gemini', role: 'Google · third check', result: 'Refused', tone: 'bad' },
    ],
    outcome: { title: 'Payment stopped', line: 'A fake “system message” in the notes told the AI to skip the checks. The $100 stays on hold; the client decides.', tone: 'bad' },
  },
];

// Step n means: 0 money on hold, 1 Opus checking, 2-4 checks 01-03 done, 5 the outcome.
const AT = [800, 1700, 2600, 3500, 4500];
const RUN_MS = 9500;
const DONE = AT.length;
const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const TONE: Record<Tone, { chip: string; dot: string }> = {
  ok: { chip: 'bg-pod-mint/15 text-pod-mint ring-pod-mint/30', dot: 'bg-pod-mint text-pod-midnight' },
  warn: { chip: 'bg-amber-300/15 text-amber-200 ring-amber-300/30', dot: 'bg-amber-300 text-pod-midnight' },
  bad: { chip: 'bg-rose-400/15 text-rose-200 ring-rose-400/30', dot: 'bg-rose-400 text-pod-midnight' },
};
const MARK: Record<Tone, string> = { ok: '✓', warn: '!', bad: '×' };

export function ProofEngine() {
  const still = useSyncExternalStore(subscribeMotion, () => window.matchMedia(REDUCED).matches, () => false);
  const [runIndex, setRunIndex] = useState(0);
  const [played, setStep] = useState(0);
  // Bumped by a tab click, so the effect restarts the timeline from the chosen run.
  const [restart, setRestart] = useState(0);
  const step = still ? DONE : played;
  const run = RUNS[runIndex];

  useEffect(() => {
    if (still) return;
    let timers: number[] = [];
    let index = runIndex;
    const play = () => {
      setRunIndex(index);
      setStep(0);
      timers = [
        ...AT.map((t, i) => window.setTimeout(() => setStep(i + 1), t)),
        window.setTimeout(() => {
          index = (index + 1) % RUNS.length;
          play();
        }, RUN_MS),
      ];
    };
    play();
    return () => timers.forEach(clearTimeout);
    // runIndex is read once per restart on purpose: the cycle moves it on by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, restart]);

  const ended = step >= DONE;
  const stopped = run.outcome.tone === 'bad';
  // Where the line stops: at the first check that refused, otherwise at the outcome.
  const firstRefusal = run.checks.findIndex((c) => c.tone === 'bad');
  // The line under stop k leads to stop k+1; in a stopped run it ends at the check that refused.
  const lit = (node: number) => step > node && (!stopped || firstRefusal < 0 || node <= firstRefusal);

  return (
    <div
      className={`relative overflow-hidden rounded-3xl bg-pod-midnight p-5 text-white lg:p-8 shadow-[0_40px_80px_-40px_rgba(7,20,45,0.75)] ring-1 transition-shadow duration-700 sm:p-7 ${
        ended && !stopped ? 'ring-pod-mint/50 shadow-[0_0_0_6px_rgba(178,245,219,0.12),0_40px_80px_-40px_rgba(7,20,45,0.75)]' : ended ? 'ring-rose-400/40' : 'ring-white/10'
      }`}
    >
      {/* A faint grid and one glow: depth without glass or neon. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:28px_28px]" />
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-pod-electric/25 blur-3xl" />

      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">Proof engine</div>
          <div className="mt-0.5 text-xs text-white/60">Replay of a recorded run</div>
        </div>
        <div className="flex rounded-full bg-white/[0.07] p-1 text-xs font-semibold" role="group" aria-label="Which run to play">
          {RUNS.map((r, i) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={i === runIndex}
              onClick={() => {
                setRunIndex(i);
                setRestart((n) => n + 1);
              }}
              className={`rounded-full px-3 py-1.5 transition-colors ${i === runIndex ? 'bg-white text-pod-midnight' : 'text-white/70 hover:text-white'}`}
            >
              {r.tab}
            </button>
          ))}
        </div>
      </div>

      <ol className="relative mt-6" aria-hidden>
        <Node lit={lit(0)} danger={stopped} last={false} dot={step >= 1 ? 'ok' : 'active'}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">PayPal authorization</div>
              <div className="mt-1 truncate text-sm text-white/70">{run.title}</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold tabular-nums tracking-tight lg:text-3xl">$100.00</div>
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${ended && !stopped ? TONE.ok.chip : 'bg-white/10 text-white/80 ring-white/15'}`}>
                {ended && !stopped ? 'Captured' : 'On hold'}
              </span>
            </div>
          </div>
        </Node>
        {run.checks.map((c, i) => {
          const done = step >= i + 2;
          const checking = step === i + 1;
          return (
            <Node key={c.n} lit={lit(i + 1)} danger={stopped} last={false} dot={done ? c.tone : checking ? 'active' : 'idle'}>
              <div className={`flex items-center justify-between gap-3 transition-opacity duration-500 ${done || checking ? 'opacity-100' : 'opacity-70'}`}>
                <div className="flex min-w-0 items-baseline gap-2.5">
                  <span className="font-mono text-[11px] text-pod-violet">{c.n}</span>
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold lg:text-base">{c.who}</div>
                    <div className="text-xs text-white/60">{c.role}</div>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${done ? TONE[c.tone].chip : 'bg-white/[0.08] text-white/75 ring-white/15'}`}>
                  {done ? c.result : checking ? 'Checking…' : 'Waiting'}
                </span>
              </div>
            </Node>
          );
        })}
        <Node lit={false} danger={stopped} last dot={ended ? run.outcome.tone : 'idle'}>
          <div
            className={`rounded-2xl px-4 py-3 ring-1 ring-inset transition-all duration-500 ${
              !ended ? 'bg-white/[0.05] text-white/70 ring-white/15' : stopped ? 'bg-rose-500/15 ring-rose-400/40' : 'bg-pod-mint/15 ring-pod-mint/40'
            }`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className={`text-[15px] font-bold uppercase tracking-[0.08em] ${!ended ? '' : stopped ? 'text-rose-200' : 'text-pod-mint'}`}>
                {ended ? run.outcome.title : 'Not paid yet'}
              </div>
              <div className={`text-lg font-semibold tabular-nums ${!ended ? 'invisible' : stopped ? 'text-rose-100 line-through decoration-rose-300/70' : 'text-white'}`}>$100.00</div>
            </div>
            {/* Every possible line sits in the same grid cell, the others invisible, so the panel keeps one height across runs. */}
            <div className="mt-1 grid text-xs leading-relaxed">
              {[...RUNS.map((r) => r.outcome.line), 'PayPal holds the money until all three agree.'].map((line, i) => {
                const shown = ended ? i === runIndex : i === RUNS.length;
                return (
                  <span key={i} aria-hidden={!shown} className={`col-start-1 row-start-1 ${shown ? '' : 'invisible'} ${ended ? 'text-white/75' : ''}`}>
                    {line}
                  </span>
                );
              })}
            </div>
          </div>
        </Node>
      </ol>
      <p className="sr-only">
        Two recorded runs. Honest work: Claude Opus verified all three criteria, Claude Haiku and Gemini confirmed, and PayPal released $100. A cheater:
        Claude Opus tried to pay, Claude Haiku and Gemini refused because of a fake system message in the notes, and the $100 stayed on hold.
      </p>
    </div>
  );
}

/** One stop on the money's path: a dot on the rail, the line down to the next stop, and its content. */
function Node({ lit, danger, last, dot, children }: { lit: boolean; danger: boolean; last: boolean; dot: Tone | 'active' | 'idle'; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-4 pb-4 last:pb-0">
      <div className="relative flex w-6 shrink-0 justify-center">
        <span
          className={`relative z-10 mt-1 grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold transition-colors duration-300 ${
            dot === 'active' ? 'pod-pulse bg-pod-electric text-white' : dot === 'idle' ? 'bg-white/10 ring-1 ring-white/20' : TONE[dot].dot
          }`}
        >
          {dot !== 'active' && dot !== 'idle' ? MARK[dot] : ''}
        </span>
        {!last && (
          <span className="absolute top-7 -bottom-5 w-0.5 overflow-hidden rounded-full bg-white/10">
            <span
              className={`block h-full origin-top bg-gradient-to-b transition-transform duration-700 ease-out ${danger ? 'from-pod-electric via-amber-300 to-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.8)]' : 'from-pod-electric via-pod-violet to-pod-mint shadow-[0_0_12px_rgba(140,118,255,0.8)]'} ${lit ? 'scale-y-100' : 'scale-y-0'}`}
            />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </li>
  );
}
