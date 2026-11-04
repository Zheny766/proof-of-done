import type { Metadata } from 'next';
import { connection } from 'next/server';
import { SiteHeader } from '@/app/components/site-header';
import { fmtDate, fmtMoney } from '@/app/components/status';
import { sandboxRuns, type SandboxRun } from '@/lib/escrow/sandbox-runs';
import { modelName } from '../m/[id]/ui';

export const metadata: Metadata = { title: 'Ran on the real PayPal sandbox' };

// Deals recorded end to end against the real PayPal sandbox (lib/escrow/sandbox-runs.ts), with every
// id PayPal returned. The hosted demo itself runs on simulated holds, so this is where the real ones are.
export default async function SandboxPage() {
  await connection();
  const runs = sandboxRuns();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-6 pb-20 pt-12">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-pp-blue">Real PayPal sandbox · not a replay</p>
        <h1 className="mt-3 font-display text-4xl leading-tight text-pp-navy">These deals ran on the real PayPal sandbox</h1>
        <p className="mt-4 max-w-3xl text-[17px] leading-relaxed text-pp-muted">
          Every id below came back from <code className="text-[15px]">api-m.sandbox.paypal.com</code>: the order the client approved in the PayPal popup, the
          authorization that held the money, the capture, and the payout to the freelancer. Runs recorded since we started logging each REST call also
          list those calls with PayPal&apos;s debug id, which is how PayPal finds a request on its side. The brief, the delivered work and everyone&apos;s
          email stay out of it.
        </p>
        {runs.length === 0 && <p className="mt-10 rounded-xl bg-pp-canvas px-4 py-3 text-pp-muted">No runs saved yet.</p>}
        <div className="mt-10 space-y-8">
          {runs.map((run) => (
            <Run key={run.id} run={run} />
          ))}
        </div>
      </main>
    </>
  );
}

function outcome(run: SandboxRun) {
  const p = run.paypal;
  if (p.voidedAt) return { label: 'Hold voided, nothing charged', tone: 'bg-slate-100 text-slate-700' };
  if (p.captureId && p.capturedAmount && Number(p.capturedAmount) < Number(run.amount))
    return { label: `Settled for ${fmtMoney(p.capturedAmount, run.currency)} of ${fmtMoney(run.amount, run.currency)}`, tone: 'bg-emerald-50 text-emerald-800' };
  if (p.captureId) return { label: `Paid ${fmtMoney(p.capturedAmount ?? run.amount, run.currency)}`, tone: 'bg-emerald-50 text-emerald-800' };
  return { label: p.reauthorizedAt ? 'On hold, renewed' : 'On hold', tone: 'bg-blue-50 text-pp-blue' };
}

function Run({ run }: { run: SandboxRun }) {
  const p = run.paypal;
  const o = outcome(run);
  const steps: [string, string | null, string | null][] = [
    ['Order approved in the PayPal popup', p.orderId ?? null, null],
    ['Money on hold (authorization)', p.previousAuthorizationId ?? p.authorizationId ?? null, p.authorizedAt],
    ...(p.previousAuthorizationId ? [['Hold renewed after the 3-day honor period', p.authorizationId, p.reauthorizedAt] as [string, string, string | null]] : []),
    ...(p.captureId ? [[`Captured ${fmtMoney(p.capturedAmount ?? run.amount, run.currency)}`, p.captureId, p.capturedAt] as [string, string, string | null]] : []),
    ...(p.payoutBatchId
      ? [[`Paid out to the freelancer${p.payoutStatus === 'SUCCESS' ? ': arrived' : p.payoutStatus ? ` (${p.payoutStatus.toLowerCase()})` : ''}`, p.payoutBatchId, null] as [string, string, string | null]]
      : []),
    ...(p.voidedAt ? [['Hold voided', null, p.voidedAt] as [string, null, string]] : []),
  ];
  const met = run.criteria.filter((c) => c.status === 'met').length;
  return (
    <article className="rounded-3xl border border-pp-border bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl text-pp-navy">{run.title}</h2>
          <p suppressHydrationWarning className="mt-1 text-sm text-pp-muted">
            {fmtMoney(run.amount, run.currency)} · {fmtDate(run.createdAt)}
            {run.takenBy && <> · taken from the job board by {run.takenBy}</>}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${o.tone}`}>{o.label}</span>
      </div>

      {!run.review && run.paypal.captureId && (
        <p className="mt-4 text-[15px] leading-relaxed text-pp-ink">No AI review on this one: the client looked at the work and released the payment by hand.</p>
      )}
      {run.review && (
        <p className="mt-4 text-[15px] leading-relaxed text-pp-ink">
          {run.review.reviewer?.startsWith('claude') ? modelName(run.review.reviewer) : 'The reviewer'} found {met} of {run.criteria.length} criteria met and decided to{' '}
          <b>{run.review.decision === 'release' ? 'pay' : run.review.decision === 'request_changes' ? 'ask for changes' : run.review.decision === 'escalate' ? 'hand it to the client' : 'wait'}</b>
          {run.review.secondOpinion && (
            <>
              ; the second opinion ({run.review.secondOpinion.by?.startsWith('claude') ? modelName(run.review.secondOpinion.by) : run.review.secondOpinion.by}){' '}
              {run.review.secondOpinion.agreed ? 'confirmed it' : 'refused'}
            </>
          )}
          {run.review.thirdCheck && !run.review.thirdCheck.unavailable && (
            <>
              , and Google&apos;s check ({modelName(run.review.thirdCheck.by)}) {run.review.thirdCheck.agreed ? 'confirmed it too' : 'refused'}
            </>
          )}
          .
        </p>
      )}

      <h3 className="mt-6 text-xs font-semibold uppercase tracking-[0.14em] text-pp-muted">How the money moved</h3>
      <ol className="mt-3 space-y-2">
        {steps.map(([label, id, at], i) => (
          <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl bg-pp-canvas/70 px-4 py-3">
            <span className="text-[15px] text-pp-ink">{label}</span>
            <span suppressHydrationWarning className="font-mono text-xs text-pp-muted">
              {id}
              {at && <>{id && ' · '}{fmtDate(at)}</>}
            </span>
          </li>
        ))}
      </ol>

      {run.calls.length > 0 && (
        <details className="group mt-5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-pp-blue">
            <span className="group-open:hidden">Show the {run.calls.length} PayPal REST calls, with PayPal&apos;s debug ids</span>
            <span className="hidden group-open:inline">PayPal REST calls</span>
          </summary>
          <ol className="mt-3 space-y-1.5">
            {run.calls.map((c, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-3 rounded-lg bg-pp-canvas/70 px-3 py-2 font-mono text-[11px] leading-5">
                <span className="min-w-0 break-all">
                  <b>{c.method}</b> {c.path}
                </span>
                <span className="shrink-0 text-pp-muted">
                  <span className={c.status < 300 ? 'text-emerald-700' : 'text-pp-danger'}>{c.status}</span>
                  {c.debugId && <> · debug id {c.debugId}</>}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <details className="group mt-3">
        <summary className="cursor-pointer list-none text-sm font-semibold text-pp-blue">
          <span className="group-open:hidden">Show every step ({run.timeline.length})</span>
          <span className="hidden group-open:inline">Every step, and who took it</span>
        </summary>
        <ol className="mt-3 space-y-1.5 text-sm">
          {run.timeline.map((e, i) => (
            <li key={i} suppressHydrationWarning className="flex gap-3">
              <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-pp-muted">{e.actor === 'agent' ? 'AI reviewer' : e.actor}</span>
              <span className="text-pp-ink">{e.text}</span>
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}
