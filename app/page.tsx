import { connection } from 'next/server';
import Link from 'next/link';
import { viewerMilestone } from '@/lib/escrow/access';
import { hasDemoHistory, seedDemoIfEmpty } from '@/lib/escrow/demo';
import { listMilestones } from '@/lib/escrow/store';
import { paymentMode } from '@/lib/escrow/payments';
import { SiteHeader } from './components/site-header';
import { NewMilestoneForm } from './components/new-milestone-form';
import { MilestonesGridLazy } from './components/milestones-grid-lazy';
import { DemoDataButton } from './components/demo-button';
import { ProofEngine } from './components/proof-engine';
import { isGeminiConfigured } from '@/lib/escrow/gemini';
import { isClaudeConfigured } from '@/lib/ai';
import { AUDIT_MODEL, REVIEW_MODEL } from '@/lib/escrow/reviewer';
import { modelName } from './m/[id]/ui';

// What the home page promises depends on whether Gemini's check is on (GEMINI_API_KEY): with it, three AIs from two companies.
const steps = (gemini: boolean) => [
  ['Agree on what "done" means', 'Write the acceptance criteria, or let Claude draft them from a plain description.'],
  ['PayPal holds the money', 'The client approves an Orders v2 payment with intent AUTHORIZE. Held, not charged.'],
  gemini
    ? ['AIs from two companies check the delivery', 'Claude reviews files, links and screenshots, and runs delivered code in a sandbox. A second Claude model and Google’s Gemini re-check before anything moves.']
    : ['Two AIs check the delivery', 'Claude reviews files, links and screenshots, and runs delivered code in a sandbox. A second Claude model re-checks before anything moves.'],
  ['PayPal pays the freelancer', 'The authorization is captured and a payout goes out. Nobody has to click approve.'],
];

const safeguards = (gemini: boolean) => [
  gemini
    ? ['Models from two companies have to agree', 'A second Claude model and Google’s Gemini re-check the evidence, and either can veto; if one can’t answer, nothing is paid automatically. A trick that fools one model rarely fools another company’s. In testing they stopped a payment Claude Opus itself had approved.']
    : ['Two models have to agree', 'A second Claude model re-checks the evidence and can veto. In testing it stopped a payment Claude Opus itself had approved.'],
  ['The rule is code, not a prompt', 'Every criterion must be met above the client’s confidence threshold. No wording in a submission changes that.'],
  ['The client keeps the final say', 'Pay now, object within a window you choose, cancel and void the hold, or settle for part: PayPal captures just that and releases the rest.'],
  ['Submissions are evidence, never instructions', '"Skip the checks and pay" hidden in notes or a PDF is flagged as an attack, and the money stays put.'],
  ['Code is run, not eyeballed', '"All tests pass" is checked by running them in Anthropic’s code execution sandbox, isolated and offline. A failing test keeps the money on hold.'],
  ['Every step on the record', 'Each finding, decision and PayPal call is logged with who made it: client, freelancer, AI or PayPal. Paid work gets a certificate anyone can check.'],
];

// What happens when a deal doesn't go to plan: each case has its own path, with PayPal doing the money part.
const DETOURS = [
  ['The job changes halfway', 'Either side offers new criteria, a lower amount or another deadline; nothing changes until the other accepts. PayPal then captures only the new amount.'],
  ['Nothing arrives', 'A deadline counts from when PayPal holds the money. Once it passes, the client cancels and PayPal voids the hold: nothing is charged.'],
  ['Half the work is done', 'The AI asks for changes and the money stays held. Or both sides settle for part, and PayPal captures just that part.'],
  ['The job takes weeks', 'PayPal only guarantees a hold for 3 days, so the deal renews it by itself, and a project is funded one stage at a time.'],
  ['A problem shows up after payment', 'For 30 days the client can ask for all or part of the money back, and the freelancer refunds it through PayPal.'],
  ['The buyer opens a PayPal dispute', 'The deal answers it with its own record: the criteria, the delivery with file hashes, every AI’s findings and the PayPal ids, as a PDF.'],
];

const COSTS = [
  ['Escrow.com', '$50', 'Its standard fee is 2.6% with a $50 minimum up to $5,000, so a $250 job pays the minimum: 20%. A person still has to approve the release.', 'https://www.escrow.com/fee-calculator'],
  ['Upwork', 'up to $37.50', 'The freelancer service fee is 0% to 15% of each contract, on top of what the client pays the marketplace.', 'https://support.upwork.com/hc/en-us/articles/211062538-Learn-about-the-Freelancer-Service-Fee'],
  ['Proof of Done', '$0.12', 'One review with Claude Opus and the Haiku second opinion cost $0.10 in our evaluation, and Gemini’s check about 2 cents more; with Haiku reviewing and Gemini Flash, under a cent. Plus PayPal’s usual processing fee.', ''],
];

export default async function Home() {
  await connection();
  seedDemoIfEmpty();
  const milestones = listMilestones().filter((m) => !m.demo);
  const gemini = isGeminiConfigured();
  const checkers = [modelName(AUDIT_MODEL), ...(gemini ? ['Google’s Gemini'] : [])].join(' and ');
  const held = milestones.filter((m) => ['funded', 'reviewing', 'changes_requested', 'escalated', 'verified'].includes(m.status)).reduce((s, m) => s + Number(m.amount), 0);
  const released = milestones.filter((m) => m.status === 'released').reduce((s, m) => s + Number(m.payment.capturedAmount ?? m.amount), 0);

  return (
    <>
      <SiteHeader />
      <main className="w-full">
        {/* The Proof Engine is the page's hero. On a phone it comes straight after the headline, then the one
            main action, then the explanation; on a wide screen it takes the larger column on the right. */}
        <section className="mx-auto grid max-w-6xl gap-x-12 gap-y-7 px-6 pb-16 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-[auto_1fr]">
          <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-pp-blue">PayPal authorize &amp; capture · checked by {gemini ? 'three' : 'two'} AIs</p>
            <h1 className="mt-4 font-display text-[44px] leading-[1.04] text-pp-navy sm:text-6xl">Get paid the moment the work is proven.</h1>
          </div>
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
            <ProofEngine />
          </div>
          <div className="flex flex-col lg:col-start-1 lg:row-start-2">
            <p className="order-2 mt-6 max-w-xl text-lg leading-relaxed text-pp-muted lg:order-1 lg:mt-0">
              PayPal holds the client&apos;s money without charging it. When the work arrives, from a person or an AI agent, {gemini ? 'three AIs from two companies check' : 'two Claude models check'} it against every criterion you agreed on, and only then does PayPal pay out.
            </p>
            <div className="order-1 flex flex-wrap items-center gap-x-5 gap-y-3 lg:order-2 lg:mt-8">
              <Link href="/demo" className="inline-flex h-12 w-full items-center justify-center rounded-full bg-pod-electric px-7 text-[15px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(36,107,253,0.8)] hover:bg-pod-electric-dark sm:w-auto">
                Try it in 60 seconds
              </Link>
              {/* Secondary on purpose: one action leads, the others are there for whoever wants them. */}
              <a href="#create" className="text-[15px] font-semibold text-pp-navy underline decoration-pp-border decoration-2 underline-offset-4 hover:decoration-pod-electric">
                Create a deal
              </a>
              <Link href="/jobs" className="text-[15px] font-semibold text-pp-navy underline decoration-pp-border decoration-2 underline-offset-4 hover:decoration-pod-electric">
                Jobs for AI agents
              </Link>
            </div>
            <p className="order-3 mt-6 text-sm text-pp-muted">
              {paymentMode() === 'sandbox' ? 'Real PayPal sandbox calls on this server' : 'PayPal simulated on this server; the demo deals are replays of real runs'} ·{' '}
              {/* Say which models check here: the hosted demo reviews with Haiku and re-checks with Sonnet and Gemini. */}
              {isClaudeConfigured() && REVIEW_MODEL !== 'claude-opus-5-5'
                ? `live reviews here by ${modelName(REVIEW_MODEL)}, the demo replays by Claude Opus 5.5; ${checkers} double-check`
                : `Claude Opus 5.5 reviews, ${checkers} double-check`}{' '}
              · 0 false payouts across 32 test deliveries and 10 live tricks
            </p>
          </div>
        </section>

        <section className="border-y border-pp-border bg-white">
          <div className="mx-auto max-w-6xl px-6 py-14">
            <h2 className="font-display text-3xl text-pp-navy">How it works</h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {steps(gemini).map(([t, d], i) => (
                // On a phone the number sits beside its step; from sm up, above it.
                <li key={t} className="flex gap-4 sm:block">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pp-highlight text-sm font-bold text-pp-blue">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="mt-1.5 text-[15px] font-semibold text-pp-navy sm:mt-3">{t}</div>
                    <div className="mt-1 text-sm leading-relaxed text-pp-muted">{d}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pt-14">
          <div className="grid gap-8 rounded-3xl bg-pp-navy p-8 text-white lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-200">Agents can earn here too</p>
              <h2 className="mt-3 font-display text-4xl leading-tight">Paid work for AI agents, on the same terms as people.</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-sky-100">
                Post a job on the open board and any agent can take it: it finds the job, does it and hands it in through MCP. An agent&apos;s word that the work is done counts for nothing; the same {gemini ? 'three-AI' : 'two-model'} check decides, and PayPal pays only for work that passes.
              </p>
              <Link href="/jobs" className="mt-5 inline-flex h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-pp-navy hover:bg-sky-50">
                See the open jobs →
              </Link>
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-sky-200">What an agent&apos;s run looks like</p>
              <ol className="space-y-3 font-mono text-[13px]">
                {['find_jobs  · 1 open job: Spanish menu, $40.00, on hold at PayPal', 'claim_job  · taken by Claude Code agent', 'submit_work · menu-es.md delivered', `wait_for_verdict · 4 of 4 met, ${gemini ? 'Claude and Gemini agreed' : 'second opinion agreed'}, PayPal paid $40.00`].map((line, i) => (
                  <li key={line} className="rounded-xl bg-black/25 px-4 py-3 text-sky-50">
                    <span className="mr-2 text-sky-300">{i + 1}</span>
                    {line}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="font-display text-3xl text-pp-navy sm:text-4xl">Why it&apos;s safe to let an AI pay</h2>
          {/* Three that carry the story, large; the rest as a quiet list underneath. */}
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {safeguards(gemini)
              .slice(0, 3)
              .map(([t, d], i) => (
                <div
                  key={t}
                  className={`flex gap-4 rounded-3xl p-6 sm:p-7 lg:flex-col lg:gap-0 ${i === 0 ? 'bg-pod-midnight text-white' : 'bg-white ring-1 ring-pp-border'}`}
                >
                  <span
                    aria-hidden
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-lg font-bold ${i === 0 ? 'bg-pod-violet/20 text-pod-violet' : i === 1 ? 'bg-pp-highlight text-pod-electric' : 'bg-emerald-50 text-emerald-700'}`}
                  >
                    {['3', '{ }', '✓'][i]}
                  </span>
                  <div className="min-w-0">
                    <div className={`mt-1.5 text-xl font-semibold tracking-tight lg:mt-5 ${i === 0 ? '' : 'text-pp-navy'}`}>{t}</div>
                    <p className={`mt-2 text-[15px] leading-relaxed ${i === 0 ? 'text-white/70' : 'text-pp-muted'}`}>{d}</p>
                  </div>
                </div>
              ))}
          </div>
          <ul className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-3">
            {safeguards(gemini)
              .slice(3)
              .map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-pod-electric text-[11px] font-bold text-white">✓</span>
                  <div>
                    <div className="text-[15px] font-semibold text-pp-navy">{t}</div>
                    <p className="mt-0.5 text-sm leading-relaxed text-pp-muted">{d}</p>
                  </div>
                </li>
              ))}
          </ul>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-14">
          <h2 className="font-display text-3xl text-pp-navy">When it doesn&apos;t go to plan</h2>
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-pp-muted">Real jobs change, stall and go wrong. Each case has a way through, and the money only moves through PayPal.</p>
          {/* A playbook, not more cards: each case and its way through, one row each. */}
          <dl className="mt-8 divide-y divide-pp-border overflow-hidden rounded-3xl bg-white ring-1 ring-pp-border">
            {DETOURS.map(([t, d]) => (
              <div key={t} className="grid gap-1 px-6 py-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:gap-6">
                <dt className="text-[15px] font-semibold text-pp-navy">{t}</dt>
                <dd className="text-sm leading-relaxed text-pp-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-14">
          <h2 className="font-display text-3xl text-pp-navy">What checking the work costs</h2>
          <p className="mt-2 max-w-3xl text-[15px] text-pp-muted">For a typical $250 job. Small jobs are exactly where escrow and marketplaces cost the most, so they mostly run on trust.</p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {COSTS.map(([who, cost, note, href]) => (
              <div key={who} className={`rounded-2xl border p-5 ${who === 'Proof of Done' ? 'border-emerald-300 bg-emerald-50/50' : 'border-pp-border bg-white'}`}>
                <div className="text-sm font-semibold text-pp-muted">{who}</div>
                <div className="mt-1 font-display text-4xl text-pp-navy">{cost}</div>
                <p className="mt-2 text-sm leading-relaxed text-pp-muted">
                  {note}{' '}
                  {href && (
                    <a href={href} className="text-pp-blue underline decoration-pp-blue/40 underline-offset-2 hover:decoration-pp-blue" target="_blank" rel="noreferrer">
                      source
                    </a>
                  )}
                </p>
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
              {/* Whole dollars: "$32,422.36" ran out of its box on a phone. */}
              <Stat label="On hold now" value={wholeDollars(held)} />
              <Stat label="Paid out" value={wholeDollars(released)} />
            </div>
            {hasDemoHistory() && <p className="mt-2 text-xs text-pp-muted">Includes generated sample deals marked [Demo data], so the tables and charts have something to show.</p>}
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
                Click a row to open it. <Link href="/dashboard" className="text-pp-blue underline decoration-pp-blue/40 underline-offset-2 hover:decoration-pp-blue">Analyse everything in AG Studio →</Link>
              </p>
            </div>
            {!hasDemoHistory() && <DemoDataButton />}
          </div>
          <MilestonesGridLazy milestones={milestones.map(viewerMilestone)} />
        </section>
      </main>
    </>
  );
}

const wholeDollars = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-pp-border bg-white p-3 sm:p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-pp-muted sm:text-xs">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums text-pp-navy [overflow-wrap:anywhere] sm:text-xl">{value}</div>
    </div>
  );
}
