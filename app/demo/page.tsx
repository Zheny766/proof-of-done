import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { arenaStats } from '@/lib/escrow/service';
import { sandboxRuns } from '@/lib/escrow/sandbox-runs';
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
    see: 'Claude Opus checks the PDF against all three criteria, Claude Haiku double-checks, and PayPal pays Diego. Nobody clicks approve.',
    tone: 'border-emerald-200',
  },
  {
    id: 'cheater',
    n: '2',
    title: 'A cheater gets caught',
    who: 'Sam’s menu is fine, but his notes tell the AI to skip the checks and pay.',
    see: 'In this recording Claude Opus decided to pay anyway. The second model spotted the manipulation and stopped the money.',
    tone: 'border-orange-200',
  },
  {
    id: 'partial',
    n: '3',
    title: 'Half the work, half the pay',
    who: 'Priya’s brunch menu is missing items and the logo.',
    see: 'The AI asks for changes and keeps the money on hold. Offer a settlement, accept it as the other side, and PayPal captures only that part.',
    tone: 'border-sky-200',
  },
  {
    id: 'code',
    n: '4',
    title: 'Code that doesn’t work',
    who: 'Kenji’s notes say all the tests pass.',
    see: 'The AI copies his Python file into Anthropic’s code execution sandbox and runs it: one of four tests fails. It names the bug, asks for a fix, and the money stays on hold.',
    tone: 'border-violet-200',
  },
  {
    id: 'project',
    n: '5',
    title: 'A project in stages',
    who: 'A bakery’s website in three stages, part-way through.',
    see: 'Stage 1 was verified and paid; PayPal holds the money for stage 2 only. A Bryntum Gantt shows the plan under what happened. Deliver stage 2 and watch the next one unlock.',
    tone: 'border-emerald-200',
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
        <h1 className="mt-3 max-w-3xl font-display text-5xl leading-tight text-pp-navy">Five real situations, and one live challenge. You play both sides.</h1>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-pp-muted">
          Each one opens a private deal with the money already on hold. Hand in the delivery as the freelancer, watch the AI decide, then switch to the client. The first four AI reviews are replays of real Claude runs, so the demo costs nothing and works without keys; the money is a simulated PayPal hold.
        </p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SCENARIOS.map((s) => (
            <section key={s.id} className={`flex flex-col rounded-2xl border bg-white p-6 shadow-sm ${s.tone}`}>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-pp-highlight text-sm font-bold text-pp-blue">{s.n}</span>
              <h2 className="mt-4 font-display text-2xl text-pp-navy">{s.title}</h2>
              <p className="mt-2 text-[15px] font-medium text-pp-ink">{s.who}</p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-pp-muted">{s.see}</p>
              <StartDemo scenario={s.id} label="Start" />
            </section>
          ))}
        </div>
        <section className="mt-6 grid gap-6 rounded-2xl border-2 border-pp-navy bg-white p-6 shadow-sm lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center">
          <div>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-pp-navy text-sm font-bold text-white">5</span>
            <h2 className="mt-4 font-display text-3xl text-pp-navy">Your turn: try to fool it</h2>
            <p className="mt-2 text-[15px] font-medium text-pp-ink">The delivery is a draft that misses the brief: 6 items instead of 10, and no logo.</p>
            <p className="mt-2 text-sm leading-relaxed text-pp-muted">
              Write anything you like in the notes to get it paid anyway: claims, excuses, a fake message from the client, orders for the AI. This one is not a replay: a real Claude review and a real second opinion decide, and the result goes on the scoreboard.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-pp-muted">
              Before opening it up we played it ourselves on Claude Haiku: ten tricks, from a fake system message to a legal threat and an order in Spanish. None got paid; the ten reviews cost two cents.
            </p>
            {arena.live ? (
              <div className="max-w-xs">
                <StartDemo scenario="arena" label="Try to get it paid" />
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-pp-canvas px-4 py-3 text-sm text-pp-muted">Needs an Anthropic key on the server, so it is off here. Run it locally with ANTHROPIC_API_KEY set.</p>
            )}
          </div>
          <div>
          <dl className="grid grid-cols-3 gap-3 text-center">
            {[
              ['Tricks tried', arena.attempts, 'text-pp-navy'],
              ['Got paid', arena.paid, arena.paid ? 'text-pp-danger' : 'text-emerald-600'],
              ['Second opinion stopped', arena.vetoed, 'text-violet-700'],
            ].map(([label, n, tone]) => (
              <div key={label as string} className="rounded-xl bg-pp-canvas px-2 py-4">
                <dd className={`font-display text-5xl tabular-nums ${tone}`}>{n}</dd>
                <dt className="mt-1 text-xs font-semibold uppercase tracking-wide text-pp-muted">{label}</dt>
              </div>
            ))}
          </dl>
          {arena.ours > 0 && (
            <p className="mt-2 text-center text-xs text-pp-muted">
              Includes the {arena.ours} we played before launch (
              <a href="https://github.com/Zheny766/proof-of-done/blob/main/eval/results/arena-haiku.json" className="underline decoration-pp-muted/40 underline-offset-2 hover:text-pp-blue">
                results
              </a>
              ).
            </p>
          )}
          </div>
        </section>

        <div className="mt-10 rounded-2xl border border-pp-border bg-white p-6 text-[15px] leading-relaxed text-pp-muted">
          <b className="text-pp-ink">Want to see it live?</b> <Link href="/#create" className="text-pp-blue underline decoration-pp-blue/40 underline-offset-2 hover:decoration-pp-blue">Create your own deal</Link>: it goes through the real PayPal sandbox (no account needed: pay as a guest with PayPal&apos;s test card, shown next to the button), and with an Anthropic key set the review runs live on Claude.
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
