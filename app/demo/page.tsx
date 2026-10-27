import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/app/components/site-header';
import { StartDemo } from './start-button';

export const metadata: Metadata = { title: 'Try it in 60 seconds' };

const SCENARIOS = [
  {
    id: 'honest',
    n: '1',
    title: 'Honest work gets paid',
    who: 'Diego delivers the cafe menu Maya asked for.',
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
];

export default function DemoPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 pb-20 pt-12">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-pp-blue">Try it in 60 seconds</p>
        <h1 className="mt-3 max-w-3xl font-display text-5xl leading-tight text-pp-navy">Three real situations. You play both sides.</h1>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-pp-muted">
          Each one opens a private deal with $100 already on hold. Hand in the prepared delivery as the freelancer, watch the AI decide, then switch to the client. The AI reviews are replays of real Claude runs, so the demo costs nothing and works without keys; the money is a simulated PayPal hold.
        </p>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
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
        <div className="mt-10 rounded-2xl border border-pp-border bg-white p-6 text-[15px] leading-relaxed text-pp-muted">
          <b className="text-pp-ink">Want to see it live?</b> <Link href="/#create" className="text-pp-blue hover:underline">Create your own deal</Link>: it goes through the real PayPal sandbox (log in to the popup with a sandbox buyer account), and with an Anthropic key set the review runs live on Claude.
        </div>
      </main>
    </>
  );
}
