import { connection } from 'next/server';
import Link from 'next/link';
import { listMilestones } from '@/lib/escrow/store';
import { SiteHeader } from './components/site-header';
import { NewMilestoneForm } from './components/new-milestone-form';
import { MilestonesGrid } from './components/milestones-grid';
import { DemoDataButton } from './components/demo-button';
import { fmtMoney } from './components/status';

export default async function Home() {
  await connection();
  const milestones = listMilestones();
  const held = milestones.filter((m) => ['funded', 'reviewing', 'changes_requested', 'escalated'].includes(m.status)).reduce((s, m) => s + Number(m.amount), 0);
  const released = milestones.filter((m) => m.status === 'released').reduce((s, m) => s + Number(m.amount), 0);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <section className="grid gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-pp-blue">PayPal escrow · verified by AI</p>
            <h1 className="mt-3 text-4xl font-bold leading-tight text-pp-navy">Get paid the moment the work is actually done.</h1>
            <p className="mt-4 text-lg text-pp-muted">
              The client puts the money on hold with PayPal. The freelancer delivers. An AI reviewer checks the work against the
              acceptance criteria you agreed on - and releases the payment itself when every one is met.
            </p>
            <ol className="mt-8 space-y-4">
              {[
                ['1', 'Agree on checkable criteria', 'Write them, or let Claude draft them from a plain description.'],
                ['2', 'Fund with PayPal - held, not charged', 'Orders API with intent AUTHORIZE places a hold on the full amount.'],
                ['3', 'Deliver, get verified, get paid', 'Claude reviews notes, links, screenshots and files, records evidence per criterion, and captures the payment only when policy allows.'],
              ].map(([n, t, d]) => (
                <li key={n} className="flex gap-4">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-pp-highlight text-sm font-bold text-pp-blue">{n}</span>
                  <div>
                    <div className="font-semibold text-pp-navy">{t}</div>
                    <div className="text-sm text-pp-muted">{d}</div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-8 grid grid-cols-3 gap-3">
              <Stat label="Milestones" value={String(milestones.length)} />
              <Stat label="On hold now" value={fmtMoney(held, 'USD')} />
              <Stat label="Released" value={fmtMoney(released, 'USD')} />
            </div>
          </div>
          <div className="rounded-2xl border border-pp-border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-pp-navy">New milestone</h2>
            <NewMilestoneForm />
          </div>
        </section>

        <section className="mt-14">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-bold text-pp-navy">Milestones</h2>
              <p className="text-sm text-pp-muted">Click a row to open it. <Link href="/dashboard" className="text-pp-blue hover:underline">Analyse everything in AG Studio →</Link></p>
            </div>
            <DemoDataButton />
          </div>
          <MilestonesGrid milestones={milestones} />
        </section>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-pp-border bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-pp-muted">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-pp-navy">{value}</div>
    </div>
  );
}
