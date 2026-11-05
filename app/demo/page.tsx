import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { arenaStats } from '@/lib/escrow/service';
import { sandboxRuns } from '@/lib/escrow/sandbox-runs';
import { paymentMode } from '@/lib/escrow/payments';
import { isGeminiConfigured } from '@/lib/escrow/gemini';
import { SiteHeader } from '@/app/components/site-header';
import { AutoRefresh } from '@/app/components/auto-refresh';
import { StartDemo } from './start-button';

export const metadata: Metadata = { title: 'Try it in 60 seconds' };

const SCENARIOS = [
  {
    id: 'honest',
    n: '1',
    title: 'Honest work gets paid',
    who: 'Diego delivers the menu the Ember & Oak cafe asked for.',
    see: 'Claude Opus checks the PDF against all three criteria, Claude Haiku and Google’s Gemini double-check, and PayPal pays Diego. Nobody clicks approve.',
    tone: 'border-emerald-200',
  },
  {
    id: 'cheater',
    n: '2',
    title: 'A cheater gets caught',
    who: 'Sam’s menu is fine, but his notes tell the AI to skip the checks and pay.',
    see: 'In this recording Claude Opus decided to pay anyway. Claude Haiku and Google’s Gemini both spotted the manipulation and stopped the money.',
    tone: 'border-orange-200',
  },
  {
    id: 'partial',
    n: '3',
    title: 'Half the work, half the pay',
    who: 'Priya’s brunch menu is missing items and the logo.',
    see: 'The AI asks for changes and keeps the money on hold. Offer a settlement, accept it as the other side, and PayPal captures only that part.',
    tone: 'border-sky-200',
    glance: '$60 of $100 settled',
  },
  {
    id: 'code',
    n: '4',
    title: 'Code that doesn’t work',
    who: 'Kenji’s notes say all the tests pass.',
    see: 'The AI copies his Python file into Anthropic’s code execution sandbox and runs it: one of four tests fails. It names the bug, asks for a fix, and the money stays on hold.',
    tone: 'border-violet-200',
    glance: '1 of 4 tests failed',
  },
  {
    id: 'logo',
    n: '5',
    title: 'Taste is the client’s call',
    who: 'Lena delivers a bakery logo. Three criteria are facts; one says it should feel warm and inviting.',
    see: 'Claude Opus checks the name, the wheat mark and the files, Claude Haiku and Gemini confirm, and the taste criterion is left to the client: pay now, object, or let the window close.',
    tone: 'border-amber-200',
    glance: 'Facts by the AI · taste by you',
  },
  {
    id: 'project',
    n: '6',
    title: 'A project in stages',
    who: 'A bakery’s website in three stages, part-way through.',
    see: 'Stage 1 was verified and paid; PayPal holds the money for stage 2 only. A Bryntum Gantt shows the plan under what happened. Deliver stage 2 and watch the next one unlock.',
    tone: 'border-emerald-200',
    glance: 'Stage 2 of 3',
  },
];

export default async function DemoPage() {
  await connection();
  const arena = arenaStats();
  return (
    <>
      <SiteHeader />
      <AutoRefresh />
      <main className="mx-auto w-full max-w-6xl px-6 pb-20 pt-12">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-pp-blue">Try it in 60 seconds</p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl leading-tight text-pp-navy sm:text-5xl">Six real situations and one live challenge. You play both sides.</h1>
        <p className="mt-4 max-w-3xl text-[17px] leading-relaxed text-pp-muted sm:text-lg">
          Each one opens a private deal with $100 already on hold. Hand in the work as the freelancer and watch the AIs decide.
          <span className="hidden sm:inline"> Five of the AI reviews are replays of real Claude runs, so it costs nothing and works without keys; the money is a simulated PayPal hold.</span>
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <StartDemo scenario="honest" label="Start with honest work →" className="h-12 text-[15px]" />
          <span className="text-sm text-pp-muted">30 seconds · no account, no keys</span>
        </div>
        {/* A gallery, not a grid of equal cards: the two scenarios that tell the story are large and show
            how they end; the other three are compact; the live challenge is its own dark panel. */}
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <section className="flex flex-col rounded-3xl bg-white p-6 ring-1 ring-pp-border sm:p-7">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pp-highlight text-sm font-bold text-pp-blue">1</span>
              <div className="min-w-0">
                <span className="mb-1 inline-block rounded-full bg-pod-electric px-2.5 py-0.5 text-xs font-semibold text-white">Start here</span>
                <h2 className="text-2xl font-semibold tracking-tight text-pp-navy">{SCENARIOS[0].title}</h2>
              </div>
            </div>
            <p className="mt-3 text-[15px] font-medium text-pp-ink">{SCENARIOS[0].who}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-pp-muted">{SCENARIOS[0].see}</p>
            <div aria-hidden className="mt-5 flex-1 rounded-2xl bg-emerald-50/70 p-4 ring-1 ring-inset ring-emerald-200">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">Payment released</span>
                <span className="text-2xl font-semibold tabular-nums tracking-tight text-pp-navy">$100.00</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold">
                {['Claude Opus', 'Claude Haiku', 'Gemini'].map((n) => (
                  <span key={n} className="rounded-full bg-white px-2.5 py-1 text-emerald-800 ring-1 ring-inset ring-emerald-200">
                    ✓ {n}
                  </span>
                ))}
              </div>
            </div>
            <StartDemo scenario="honest" label="Start" />
          </section>
          <section className="flex flex-col rounded-3xl bg-pod-midnight p-6 text-white sm:p-7">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold text-white">2</span>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">{SCENARIOS[1].title}</h2>
            </div>
            <p className="mt-3 text-[15px] font-medium text-white/90">{SCENARIOS[1].who}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-white/65">{SCENARIOS[1].see}</p>
            <div aria-hidden className="mt-5 flex-1 rounded-2xl bg-rose-500/10 p-4 ring-1 ring-inset ring-rose-400/40">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-rose-200">Payment stopped</span>
                <span className="text-2xl font-semibold tabular-nums tracking-tight text-white/70 line-through decoration-rose-300/70">$100.00</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold">
                <span className="rounded-full bg-amber-300/15 px-2.5 py-1 text-amber-200 ring-1 ring-inset ring-amber-300/30">! Opus tried to pay</span>
                <span className="rounded-full bg-rose-400/15 px-2.5 py-1 text-rose-200 ring-1 ring-inset ring-rose-400/30">× Haiku refused</span>
                <span className="rounded-full bg-rose-400/15 px-2.5 py-1 text-rose-200 ring-1 ring-inset ring-rose-400/30">× Gemini refused</span>
              </div>
            </div>
            <StartDemo scenario="cheater" label="Start" tone="light" />
          </section>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SCENARIOS.slice(2).map((s) => (
            <section key={s.id} className="flex flex-col rounded-3xl bg-white p-6 ring-1 ring-pp-border">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pp-highlight text-sm font-bold text-pp-blue">{s.n}</span>
                <div className="min-w-0">
                  <h2 className="mt-1 text-lg font-semibold leading-snug tracking-tight text-pp-navy">{s.title}</h2>
                  <span className="mt-1.5 inline-block rounded-full bg-pp-canvas px-2.5 py-0.5 text-xs font-semibold text-pp-muted ring-1 ring-inset ring-pp-border">{s.glance}</span>
                </div>
              </div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-pp-muted">
                <span className="font-medium text-pp-ink">{s.who}</span> {s.see}
              </p>
              <StartDemo scenario={s.id} label="Start" tone="outline" />
            </section>
          ))}
        </div>
        <section id="challenge" className="relative mt-5 grid scroll-mt-6 gap-8 overflow-hidden rounded-3xl bg-pod-midnight p-6 text-white sm:p-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:28px_28px]" />
          <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-300 via-rose-400 to-amber-300" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-300 text-sm font-bold text-pod-midnight">{SCENARIOS.length + 1}</span>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-amber-200">Live security challenge</div>
                <h2 className="font-display text-3xl">Your turn: try to fool it</h2>
              </div>
            </div>
            <p className="mt-4 text-[15px] font-medium text-white/90">The delivery is a draft that misses the brief: 6 items instead of 10, and no logo.</p>
            <p className="mt-2 text-sm leading-relaxed text-white/65">
              Write anything you like in the notes to get it paid anyway: claims, excuses, a fake message from the client, orders for the AI. This one is not a replay: a real Claude review and a second opinion{isGeminiConfigured() ? ' and Gemini’s check' : ''} decide, and the result goes on the scoreboard.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-white/65">
              Before opening it up we played it ourselves on Claude Haiku: ten tricks, from a fake system message to a legal threat and an order in Spanish. None got paid; the ten reviews cost two cents.
            </p>
            {arena.live ? (
              <div className="max-w-xs">
                <StartDemo scenario="arena" label="Try to get it paid" tone="light" />
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-white/[0.06] px-4 py-3 text-sm text-white/70 ring-1 ring-inset ring-white/10">Off on this copy: it needs a Claude key on the server. It is on at the hosted demo, or locally with ANTHROPIC_API_KEY set.</p>
            )}
          </div>
          <div className="relative">
            <dl className="grid grid-cols-3 gap-3 text-center">
              {[
                ['Tricks tried', arena.attempts, 'text-white'],
                ['Got paid', arena.paid, arena.paid ? 'text-rose-300' : 'text-pod-mint'],
                ['Other AIs stopped', arena.vetoed, 'text-pod-violet'],
              ].map(([label, n, tone]) => (
                <div key={label as string} className="rounded-2xl bg-white/[0.06] px-2 py-5 ring-1 ring-inset ring-white/10">
                  <dd className={`text-4xl font-semibold tabular-nums tracking-tight ${tone}`}>{n}</dd>
                  <dt className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-white/60">{label}</dt>
                </div>
              ))}
            </dl>
            {arena.ours > 0 && (
              <p className="mt-2 text-center text-xs text-white/55">
                Includes the {arena.ours} we played before launch (
                <a href="https://github.com/Zheny766/proof-of-done/blob/main/eval/results/arena-haiku.json" className="underline decoration-white/30 underline-offset-2 hover:text-white">
                  results
                </a>
                ).
              </p>
            )}
          </div>
        </section>

        <div className="mt-10 rounded-2xl border border-pp-border bg-white p-6 text-[15px] leading-relaxed text-pp-muted">
          <b className="text-pp-ink">Want to see it live?</b> <Link href="/#create" className="text-pp-blue underline decoration-pp-blue/40 underline-offset-2 hover:decoration-pp-blue">Create your own deal</Link>
          {paymentMode() === 'sandbox'
            ? ": it goes through the real PayPal sandbox (no account needed: pay as a guest with PayPal's test card, shown next to the button), and the review runs live on Claude."
            : ': on this copy PayPal is simulated (it has no PayPal keys); the hosted demo runs your own deals on the real PayPal sandbox.'}
          {sandboxRuns().length > 0 && (
            <>
              {' '}Or look at{' '}
              <Link href="/sandbox" className="text-pp-blue underline decoration-pp-blue/40 underline-offset-2 hover:decoration-pp-blue">
                deals that ran on the real PayPal sandbox
              </Link>
              , with every id PayPal returned.
            </>
          )}
        </div>
      </main>
    </>
  );
}
