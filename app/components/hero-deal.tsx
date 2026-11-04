'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

// The honest demo's recorded run, played back step by step: PayPal holds the money, each criterion
// is checked, the two other AIs confirm, and only then does PayPal capture. It loops, so the hero
// shows the moment the money moves instead of describing it. With reduced motion it stays on the end.

const ROWS: [string, number][] = [
  ['One-page menu, delivered as a PDF', 95],
  ['At least 10 items, each with a price', 97],
  ['The cafe logo at the top', 90],
];
// When each step happens (ms after the start); the loop starts over after the last.
const AT = [900, 1500, 2100, 2900, 3600, 4500];
const LOOP = 9000;
const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

export function HeroDeal() {
  const still = useSyncExternalStore(subscribeMotion, () => window.matchMedia(REDUCED).matches, () => false);
  const [played, setStep] = useState(0);
  const step = still ? AT.length : played;

  useEffect(() => {
    if (still) return;
    let timers: number[] = [];
    const play = () => {
      setStep(0);
      timers = [...AT.map((t, i) => window.setTimeout(() => setStep(i + 1), t)), window.setTimeout(play, LOOP)];
    };
    play();
    return () => timers.forEach(clearTimeout);
  }, [still]);

  const paid = step >= 6;
  // A step that hasn't happened yet sits there greyed out, so the card keeps its size and shows what comes next.
  const tone = (done: boolean, on: string) => `transition-colors duration-500 ring-1 ring-inset ${done ? on : 'bg-slate-50 text-slate-400 ring-slate-200'}`;

  return (
    <div aria-hidden className="rotate-1 rounded-3xl border border-pp-border bg-white p-6 shadow-[0_30px_60px_-30px_rgba(0,28,100,0.35)]">
      <div className="flex items-center justify-between">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 transition-colors duration-500 ${
            paid ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-amber-200'
          }`}
        >
          {paid ? 'Paid' : step >= 1 ? 'AIs checking' : 'On hold at PayPal'}
        </span>
        <span className={`font-display text-3xl transition-colors duration-500 ${paid ? 'text-emerald-700' : 'text-pp-navy'}`}>$100.00</span>
      </div>
      <div className="mt-2 font-display text-2xl text-pp-navy">Menu redesign for a cafe</div>
      <div className="mt-1 text-sm text-pp-muted">Ember &amp; Oak pays Diego Alvarez</div>
      <ul className="mt-5 space-y-2.5">
        {ROWS.map(([text, pct], i) => {
          const met = step >= i + 1;
          return (
            <li key={text} className="flex items-center gap-3 rounded-xl bg-pp-canvas/70 px-3 py-2.5 text-sm">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white transition-colors duration-300 ${met ? 'bg-emerald-500' : 'bg-slate-300'}`}
              >
                {met ? '✓' : ''}
              </span>
              <span className="flex-1">{text}</span>
              <span className={`text-xs font-semibold ${met ? 'text-emerald-700' : 'text-pp-muted'}`}>{met ? `${pct}%` : 'checking'}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className={`rounded-xl px-3 py-2 text-sm ${tone(step >= 4, 'bg-violet-50/70 text-violet-900 ring-violet-200')}`}>
          <div className="font-semibold">Second opinion {step >= 4 ? '✓' : '…'}</div>
          <div className="text-xs opacity-80">Claude · Anthropic</div>
        </div>
        <div className={`rounded-xl px-3 py-2 text-sm ${tone(step >= 5, 'bg-sky-50 text-sky-900 ring-sky-200')}`}>
          <div className="font-semibold">Third check {step >= 5 ? '✓' : '…'}</div>
          <div className="text-xs opacity-80">Gemini · Google</div>
        </div>
      </div>
      <div className={`mt-3 rounded-xl px-3 py-2.5 text-sm ${tone(paid, 'bg-emerald-50 text-emerald-900 ring-emerald-200')}`}>
        {paid ? (
          <>
            <b>PayPal captured $100.00</b> and paid Diego. Nobody clicked approve.
          </>
        ) : (
          <>PayPal holds $100.00 until every check agrees.</>
        )}
      </div>
    </div>
  );
}
