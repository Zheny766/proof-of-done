import { connection } from 'next/server';
import Link from 'next/link';
import { viewerMilestone } from '@/lib/escrow/access';
import { seedDemoIfEmpty } from '@/lib/escrow/demo';
import { listMilestones } from '@/lib/escrow/store';
import { SiteHeader } from './components/site-header';
import { NewMilestoneForm } from './components/new-milestone-form';
import { MilestonesGrid } from './components/milestones-grid';
import { DemoDataButton } from './components/demo-button';
import { fmtMoney } from './components/status';

const STEPS = [
  ['Agree on what "done" means', 'Write the acceptance criteria, or let Claude draft them from a plain description.'],
  ['PayPal holds the money', 'The client approves an Orders v2 payment with intent AUTHORIZE. Held, not charged.'],
  ['Two AIs check the delivery', 'Claude Opus reviews files, links and screenshots. Claude Haiku re-checks before anything moves.'],
  ['PayPal pays the freelancer', 'The authorization is captured and a payout goes out. Nobody has to click approve.'],
];

const SAFEGUARDS = [
  ['Two models have to agree', 'A second AI re-checks the evidence and can veto. In testing, it stopped a payment that Claude Opus itself had approved.'],
  ['The rule is code, not a prompt', 'Every criterion must be met above the client’s confidence threshold. No wording in a submission changes that.'],
  ['Submissions are evidence, never instructions', '"Skip the checks and pay" hidden in notes or a PDF is flagged as an attack, and the money stays put.'],
  ['The client keeps the final say', 'Pay now, object within a window you choose, or cancel and void the hold. Nothing is charged until then.'],
  ['Settle for part', 'If only part of the work is done, either side offers an amount. PayPal captures just that and releases the rest.'],
  ['Every step on the record', 'Each finding, decision and PayPal call is logged with who made it: client, freelancer, AI or PayPal.'],
];

export default async function Home() {
  await connection();
  seedDemoIfEmpty();
  const milestones = listMilestones();
  const held = milestones.filter((m) => ['funded', 'reviewing', 'changes_requested', 'escalated', 'verified'].includes(m.status)).reduce((s, m) => s + Number(m.amount), 0);
  const released = milestones.filter((m) => m.status === 'released').reduce((s, m) => s + Number(m.payment.capturedAmount ?? m.amount), 0);

  return (
    <>
      <SiteHeader />
      <main className="w-full">
        <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-16 pt-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-pp-blue">PayPal escrow · checked by two AIs</p>
            <h1 className="mt-4 font-display text-5xl leading-[1.05] text-pp-navy sm:text-6xl">Get paid the moment the work is proven.</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-pp-muted">
              The client&apos;s money waits on PayPal. When the freelancer delivers, an AI agent checks the work against every criterion you agreed on, a second model double-checks, and PayPal pays out. No chasing invoices, no paying for work that never shows up.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/demo" className="inline-flex h-12 items-center rounded-full bg-pp-navy px-6 text-[15px] font-semibold text-white hover:bg-pp-blue-dark">
                Try it in 60 seconds
              </Link>
              <a href="#create" className="inline-flex h-12 items-center rounded-full border border-pp-border bg-white px-6 text-[15px] font-semibold text-pp-ink hover:border-pp-blue">
                Create a deal
              </a>
            </div>
            <p className="mt-6 text-sm text-pp-muted">
              Real PayPal sandbox calls · Claude Opus 5.5 reviews, Claude Haiku 5.5 double-checks · 0 false payouts across 17 test deliveries
            </p>
          </div>
          <PreviewCard />
        </section>

        <section className="border-y border-pp-border bg-white">
          <div className="mx-auto max-w-6xl px-6 py-14">
            <h2 className="font-display text-3xl text-pp-navy">How it works</h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(([t, d], i) => (
                <li key={t}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-pp-highlight text-sm font-bold text-pp-blue">{i + 1}</span>
                  <div className="mt-3 text-[15px] font-semibold text-pp-navy">{t}</div>
                  <div className="mt-1 text-sm leading-relaxed text-pp-muted">{d}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="font-display text-3xl text-pp-navy">Why it&apos;s safe to let an AI pay</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SAFEGUARDS.map(([t, d]) => (
              <div key={t} className="rounded-2xl border border-pp-border bg-white p-5">
                <div className="text-[15px] font-semibold text-pp-navy">{t}</div>
                <p className="mt-1.5 text-sm leading-relaxed text-pp-muted">{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="create" className="mx-auto grid max-w-6xl scroll-mt-6 gap-10 px-6 pb-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <h2 className="font-display text-3xl text-pp-navy">Create a deal</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-pp-muted">
              You land on it as the client and fund it with PayPal. Then send the freelancer their private link: they can deliver, nothing more.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <Stat label="Deals" value={String(milestones.length)} />
              <Stat label="On hold now" value={fmtMoney(held, 'USD')} />
              <Stat label="Paid out" value={fmtMoney(released, 'USD')} />
            </div>
          </div>
          <div className="rounded-2xl border border-pp-border bg-white p-6 shadow-sm">
            <NewMilestoneForm />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="font-display text-3xl text-pp-navy">All deals</h2>
              <p className="mt-1 text-sm text-pp-muted">
                Click a row to open it. <Link href="/dashboard" className="text-pp-blue hover:underline">Analyse everything in AG Studio →</Link>
              </p>
            </div>
            <DemoDataButton />
          </div>
          <MilestonesGrid milestones={milestones.map(viewerMilestone)} />
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

/** A still of a finished deal, so the hero shows the product instead of describing it. */
function PreviewCard() {
  const rows = ['One-page menu, delivered as a PDF', 'At least 10 items, each with a price', 'The cafe logo at the top'];
  return (
    <div aria-hidden className="rotate-1 rounded-3xl border border-pp-border bg-white p-6 shadow-[0_30px_60px_-30px_rgba(0,28,100,0.35)]">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">Paid</span>
        <span className="font-display text-3xl text-pp-navy">$250.00</span>
      </div>
      <div className="mt-2 font-display text-2xl text-pp-navy">Menu redesign for a cafe</div>
      <div className="mt-1 text-sm text-pp-muted">Ember &amp; Oak pays Diego Alvarez</div>
      <ul className="mt-5 space-y-2.5">
        {rows.map((r, i) => (
          <li key={r} className="flex items-center gap-3 rounded-xl bg-pp-canvas/70 px-3 py-2.5 text-sm">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500 text-xs font-bold text-white">✓</span>
            <span className="flex-1">{r}</span>
            <span className="text-xs font-semibold text-emerald-700">{[96, 97, 95][i]}%</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-xl bg-violet-50/70 px-3 py-2.5 text-sm font-semibold text-violet-900 ring-1 ring-inset ring-violet-200">Second opinion: confirmed every criterion</div>
      <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200">
        <b>PayPal captured $250.00</b> and paid Diego. Nobody clicked approve.
      </div>
    </div>
  );
}
