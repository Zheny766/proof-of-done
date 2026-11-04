import Link from 'next/link';
import type { Audit, Milestone } from '@/lib/escrow/types';
import { currentReview } from '@/lib/escrow/policy';
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
    const passed = (review ? 1 : 0) + checks.length;
    return (
      <section className="pod-rise relative mt-6 overflow-hidden rounded-3xl bg-pod-midnight px-6 py-6 text-white ring-1 ring-pod-mint/40 sm:px-8">
        <span aria-hidden className="pod-sweep absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-pod-mint to-transparent" />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 sm:gap-4">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full sm:h-12 sm:w-12 bg-pod-mint text-2xl font-black text-pod-midnight shadow-[0_0_0_8px_rgba(178,245,219,0.12)]">
              ✓
            </span>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
                {settled ? 'Settled.' : byAI ? 'Work verified.' : 'Approved.'} <span className="text-pod-mint">{fmtMoney(captured, m.currency)} released.</span>
              </h2>
              <p className="mt-1.5 text-[15px] text-white/75">
                {settled
                  ? `Both sides agreed on part of ${fmtMoney(m.amount, m.currency)}: PayPal captured just that, and the rest of the hold went back to the client.`
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
      <section className="pod-rise relative mt-6 overflow-hidden rounded-3xl bg-pod-midnight px-6 py-6 text-white ring-1 ring-rose-400/40 sm:px-8">
        <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-300 via-rose-400 to-amber-300" />
        <div className="flex items-start gap-3 sm:gap-4">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full sm:h-12 sm:w-12 bg-rose-400 text-2xl font-black text-pod-midnight shadow-[0_0_0_8px_rgba(251,113,133,0.15)]">
            ×
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200">Payment stopped</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">
              {fmtMoney(m.amount, m.currency)} <span className="text-white/60">stays on hold at PayPal.</span>
            </h2>
            <p className="mt-1.5 text-[15px] text-white/75">
              {refusals.map(who).join(' and ')} refused to confirm the release, so nothing was paid and {m.client.name} decides.
            </p>
            {reason && (
              <p className="mt-3 rounded-xl bg-white/[0.06] px-4 py-3 text-sm leading-relaxed text-white/85 ring-1 ring-inset ring-white/10 [overflow-wrap:anywhere]">
                <span className="font-semibold text-amber-200">Why: </span>
                {reason.replace(/^[\w.-]+: /, '')}
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }
  return null;
}
