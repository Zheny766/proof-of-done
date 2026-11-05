import Link from 'next/link';
import type { Audit, Milestone } from '@/lib/escrow/types';
import { currentReview, latestFindings } from '@/lib/escrow/policy';
import { fmtMoney } from '@/app/components/status';
import { modelName } from './ui';

// The moment a deal ends one way or the other, as its own screen at the top of the deal page: money
// released after the checks passed, or a payment the independent checks stopped. Every line comes
// from the deal's own record: the review, the second opinion, Gemini's check and PayPal's capture.

/** The independent checks that ran on a review: Claude's second opinion, then any panel (Gemini). */
const checksOf = (audit?: Audit, panel?: Audit[]) => [...(audit ? [audit] : []), ...(panel ?? []).filter((a) => !a.unavailable)];

const who = (a: Audit) => (a.engine === 'gemini' ? 'Gemini' : a.engine === 'claude' ? modelName(a.model).replace(/ \d.*$/, '') : 'The simulated check');

/** Whether the deal has an outcome screen: paid, or stopped by an independent check. */
export const hasOutcome = (m: Milestone) => {
  const review = currentReview(m);
  return m.status === 'released' || (m.status === 'escalated' && checksOf(review?.audit, review?.panel).some((a) => !a.agreed));
};

export function Outcome({ m }: { m: Milestone }) {
  const review = currentReview(m);
  const checks = checksOf(review?.audit, review?.panel);
  const refunded = (m.payment.refunds ?? []).filter((r) => r.status !== 'FAILED' && r.status !== 'CANCELLED').reduce((sum, r) => sum + Number(r.amount), 0);

  if (m.status === 'released') {
    const captured = Number(m.payment.capturedAmount ?? m.amount);
    const settled = m.payment.capturedAmount && captured < Number(m.amount);
    const byAI = m.timeline.some((e) => e.type === 'verified') && checks.length > 0 && checks.every((a) => a.agreed);
    // After the AI verified it, the client may still have paid by hand (in the objection window), or let the window close.
    const approved = m.timeline.some((e) => e.type === 'approved');
    const windowClosed = m.timeline.some((e) => e.type === 'window_closed');
    const taste = m.criteria.some((c) => c.judge === 'client');
    const passed = (review ? 1 : 0) + checks.length;
    return (
      <section id="outcome" className="pod-rise relative mt-6 scroll-mt-4 overflow-hidden rounded-3xl bg-pod-midnight px-6 py-6 text-white ring-1 ring-pod-mint/40 sm:px-8">
        <span aria-hidden className="pod-sweep absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-pod-mint to-transparent" />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 sm:gap-4">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full sm:h-12 sm:w-12 bg-pod-mint text-2xl font-black text-pod-midnight shadow-[0_0_0_8px_rgba(178,245,219,0.12)]">
              ✓
            </span>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
                {settled ? 'Settled.' : byAI && approved ? 'Verified and accepted.' : byAI ? 'Work verified.' : 'Approved.'} <span className="text-pod-mint">{fmtMoney(captured, m.currency)} released.</span>
              </h2>
              <p className="mt-1.5 text-[15px] text-white/75">
                {settled
                  ? `Both sides agreed on part of ${fmtMoney(m.amount, m.currency)}: ${m.payment.mode === 'simulated' ? 'the simulated hold paid' : 'PayPal captured'} just that, and the rest of the hold went back to the client.`
                  : byAI && approved
                    ? `${passed} AI checks passed${taste ? ' on the facts' : ''} · ${m.client.name} ${taste ? 'accepted the rest' : 'paid without waiting for the window'}, and PayPal captured the hold and paid ${m.freelancer.name}.`
                    : byAI && windowClosed
                      ? `${passed} AI checks passed · ${m.client.name} didn't object within the window, so PayPal captured the hold and paid ${m.freelancer.name}.`
                      : byAI
                        ? `${passed} AI checks passed · PayPal captured the hold and paid ${m.freelancer.name}. Nobody clicked approve.`
                        : `${m.client.name} approved it · PayPal captured the hold and paid ${m.freelancer.name}.`}
                {refunded > 0 && ` ${fmtMoney(refunded, m.currency)} was refunded since.`}
              </p>
              {byAI && (
                <ul className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                  {[...(review ? [review.engine === 'claude' || review.engine === 'replay' ? modelName(review.model).replace(/ \d.*$/, '') : 'Reviewer'] : []), ...checks.map(who)].map((name, i) => (
                    <li key={`${name}-${i}`} className="rounded-full bg-pod-mint/15 px-2.5 py-1 text-pod-mint ring-1 ring-inset ring-pod-mint/30">
                      ✓ {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <Link
            href={`/m/${m.id}/proof`}
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-pod-midnight hover:bg-pod-mint"
          >
            View proof certificate →
          </Link>
        </div>
      </section>
    );
  }

  // Stopped: the reviewer was ready to pay (or the policy passed) and an independent check refused.
  const refusals = checks.filter((a) => !a.agreed);
  if (m.status === 'escalated' && refusals.length) {
    const reason = refusals.flatMap((a) => [...a.redFlags, ...a.disputed.map((d) => d.reason).filter(Boolean)])[0] ?? refusals[0].summary;
    return (
      <section id="outcome" className="pod-rise relative mt-6 scroll-mt-4 overflow-hidden rounded-3xl bg-pod-midnight px-6 py-6 text-white ring-1 ring-rose-400/40 sm:px-8">
        <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-300 via-rose-400 to-amber-300" />
        <div className="flex items-start gap-3 sm:gap-4">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full sm:h-12 sm:w-12 bg-rose-400 text-2xl font-black text-pod-midnight shadow-[0_0_0_8px_rgba(251,113,133,0.15)]">
            ×
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200">Payment stopped</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">
              {fmtMoney(m.amount, m.currency)} <span className="text-white/60">{m.payment.mode === 'simulated' ? 'stays on hold (simulated).' : 'stays on hold at PayPal.'}</span>
            </h2>
            <p className="mt-1.5 text-[15px] text-white/75">
              {refusals.map(who).join(' and ')} refused to confirm the release, so nothing was paid and {m.client.name} decides.
            </p>
            {reason && (
              // The reason can run to several lines: on a phone two of them show, the rest opens on a tap.
              <details className="group mt-3 rounded-xl bg-white/[0.06] px-4 py-3 text-sm leading-relaxed text-white/85 ring-1 ring-inset ring-white/10 [overflow-wrap:anywhere]">
                <summary className="cursor-pointer list-none">
                  <span className="line-clamp-2 group-open:line-clamp-none sm:line-clamp-none">
                    <span className="font-semibold text-amber-200">Why: </span>
                    {reason.replace(/^[\w.-]+: /, '')}
                  </span>
                  <span className="mt-1 block text-xs font-semibold text-amber-200 group-open:hidden sm:hidden">Read all</span>
                </summary>
              </details>
            )}
          </div>
        </div>
      </section>
    );
  }
  // Verified, with time for the client to object: the AI is done, the payment waits for the window.
  if (m.status === 'verified') {
    const taste = m.criteria.filter((c) => c.judge === 'client').length;
    return (
      <section id="outcome" className="pod-rise mt-6 scroll-mt-4 rounded-3xl bg-violet-50 px-6 py-5 ring-1 ring-violet-200 sm:px-8">
        <div className="flex items-start gap-3 sm:gap-4">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-500 text-xl font-black text-white sm:h-12 sm:w-12">
            ✓
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-violet-800">{taste ? 'Facts verified · taste is the client’s call' : 'Verified · objection window'}</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-pp-navy">
              {fmtMoney(m.amount, m.currency)} <span className="text-pp-muted">goes out when the window closes.</span>
            </h2>
            <p className="mt-1.5 text-[15px] text-pp-ink">
              {taste
                ? `The AI checked every criterion it can measure, and the other AIs agreed. ${taste === 1 ? 'One is' : `${taste} are`} a matter of taste, so ${m.client.name} decides: pay now, or object before the window closes.`
                : `Every check passed. ${m.client.name} asked for time to object, so PayPal captures when the window closes, or sooner if ${m.client.name} pays now.`}
            </p>
          </div>
        </div>
      </section>
    );
  }

  // The AI's request is on the timeline at once; the review's own decision is written a moment later.
  if (m.status === 'changes_requested' && m.timeline.findLast((e) => e.type === 'changes_requested')?.actor === 'agent') {
    // Cleared means met at the client's confidence threshold, the same bar the release rule uses.
    const met = latestFindings(m.criteria, review?.findings ?? []).filter((f) => f?.status === 'met' && f.confidence >= m.releaseThreshold).length;
    const why = (review?.feedback ?? review?.summary ?? '').split('\n')[0];
    return (
      <section id="outcome" className="pod-rise mt-6 scroll-mt-4 rounded-3xl bg-amber-50 px-6 py-5 ring-1 ring-amber-200 sm:px-8">
        <div className="flex items-start gap-3 sm:gap-4">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-400 text-xl font-black text-white sm:h-12 sm:w-12">
            !
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-800">Fix asked</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-pp-navy">
              {fmtMoney(m.amount, m.currency)} <span className="text-pp-muted">stays on hold until a delivery passes.</span>
            </h2>
            <p className="mt-1.5 text-[15px] text-pp-ink">
              The AI cleared {met} of {m.criteria.length} criteria and asked {m.freelancer.name} for changes. Nothing was charged; the verdict below says what is missing.
            </p>
            {why && <p className="mt-2 line-clamp-2 text-sm text-pp-muted">“{why}”</p>}
          </div>
        </div>
      </section>
    );
  }
  return null;
}
