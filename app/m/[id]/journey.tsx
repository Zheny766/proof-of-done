'use client';

import type { Milestone } from '@/lib/escrow/types';
import { currentReview, latestFindings } from '@/lib/escrow/policy';
import { fmtMoney } from '@/app/components/status';
import { card } from './ui';

const ICONS = {
  fund: <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm13 5h.01" />,
  hold: <path d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v9H5zM12 15v2" />,
  check: <path d="M9 12a5 5 0 1 0 0-.01M15 12a5 5 0 1 0 0-.01M7.5 12.2l1.2 1.2 2.3-2.4" />,
  paid: <path d="M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 10v4M18 10v4" />,
};

/** Where the money is, as one picture: client -> PayPal hold -> two AIs check -> freelancer paid. */
export function MoneyJourney({ m }: { m: Milestone }) {
  // Index of the step in progress; 4 means every step is done.
  const stage = { awaiting_funding: 0, funded: 1, reviewing: 2, changes_requested: 2, escalated: 2, verified: 3, released: 4, cancelled: -1 }[m.status];
  const amount = fmtMoney(m.amount, m.currency);
  // The terms lowered the amount after the hold: PayPal holds more than it will capture.
  const held = m.payment.authorizedAmount && Number(m.payment.authorizedAmount) > Number(m.amount) ? fmtMoney(m.payment.authorizedAmount, m.currency) : null;
  const settled = m.payment.capturedAmount;
  const review = currentReview(m);
  const findings = review ? latestFindings(m.criteria, review.findings) : [];
  const met = findings.filter((f) => f?.status === 'met' && f.confidence >= m.releaseThreshold).length;
  // A client can approve (or both sides settle) without the AI verifying; say so instead of a tick.
  const aiSkipped = m.status === 'released' && !m.timeline.some((e) => e.type === 'verified');
  const checkSub =
    m.status === 'reviewing'
      ? 'checking right now'
      : m.status === 'changes_requested'
        ? `${met} of ${m.criteria.length} met · changes requested`
        : m.status === 'escalated'
          ? review?.audit && !review.audit.agreed
            ? 'the second check refused · the client decides'
            : 'not verified · the client decides'
          : aiSkipped
            ? settled
              ? 'settled by agreement'
              : 'the client approved'
            : stage >= 3
              ? `${m.criteria.length} of ${m.criteria.length} criteria met`
              : `${m.criteria.length} criteria agreed`;
  // Captured is not paid: a payout can still be waiting for the capture, or fail.
  const payout = m.payment.payoutStatus ?? '';
  const payoutStuck = stage === 4 && !!payout && payout !== 'SUCCESS' && !['PENDING', 'PROCESSING'].includes(payout);
  const steps = [
    { icon: ICONS.fund, title: 'Client funds', sub: m.client.name },
    {
      icon: ICONS.hold,
      title: stage >= 1 ? `PayPal holds ${held ?? amount}` : 'PayPal holds the money',
      sub:
        stage === 4
          ? settled
            ? `captured ${fmtMoney(settled, m.currency)} by agreement`
            : held
              ? `captured ${amount}, the new terms`
              : aiSkipped
                ? 'captured when the client approved'
                : 'captured once the work checked out'
          : stage >= 1
            ? held
              ? `only ${amount} will be captured (new terms)`
              : 'on hold, nothing charged yet'
            : 'nothing on hold yet',
    },
    { icon: ICONS.check, title: 'AIs check the work', sub: checkSub },
    {
      icon: ICONS.paid,
      title: payoutStuck ? 'Payout not sent yet' : settled ? `Freelancer paid ${fmtMoney(settled, m.currency)}` : stage === 4 ? `Freelancer paid ${amount}` : 'Freelancer paid',
      sub: payoutStuck
        ? payout.startsWith('HELD')
          ? 'waits for PayPal to complete the capture'
          : 'the payout did not go through'
        : settled
        ? `${fmtMoney(Number(m.amount) - Number(settled), m.currency)} went back to the client`
        : stage === 4
          ? `to ${m.freelancer.name} via PayPal`
          : m.status === 'verified'
            ? 'when the objection window closes'
            : m.freelancer.name,
    },
  ];

  if (m.status === 'cancelled') {
    return (
      <div className={`${card} mt-6 flex items-center gap-4 border-rose-200 bg-rose-50/50`}>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-rose-100 text-pp-danger">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </span>
        <div>
          <div className="text-base font-semibold text-rose-900">Cancelled</div>
          <div className="text-sm text-rose-800">{m.payment.authorizationId ? 'The client cancelled and PayPal voided the hold. Nothing was charged.' : 'Cancelled before any money was put on hold.'}</div>
        </div>
      </div>
    );
  }

  return (
    // Four across on a phone too, small, so what to do next is on the first screen; the line under each step shows from sm up.
    <ol className={`${card} mt-6 grid grid-cols-4`} aria-label="Where the money is">
      {steps.map((s, i) => {
        const done = stage > i && !(aiSkipped && i === 2) && !(payoutStuck && i === 3);
        const active = stage === i;
        // The check stopped short (held for changes, or handed to the client): amber, not "working on it".
        const held = active && i === 2 && ['changes_requested', 'escalated'].includes(m.status);
        return (
          <li key={s.title} className="relative flex flex-col items-center text-center">
            {i > 0 && (
              <span aria-hidden className="absolute top-[18px] right-1/2 h-0.5 w-full sm:top-6">
                <span className={`block h-full rounded-full ${stage >= i ? 'bg-emerald-400' : 'bg-slate-200'}`} />
              </span>
            )}
            <span
              className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full ring-2 ring-white sm:h-12 sm:w-12 sm:ring-4 ${
                done ? 'bg-emerald-500 text-white' : held ? 'bg-amber-400 text-white' : active ? 'pod-pulse bg-pp-blue text-white' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {done ? (
                <svg viewBox="0 0 24 24" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{s.icon}</svg>
              )}
            </span>
            <div className="mt-2 min-w-0 px-1 sm:mt-3 sm:px-3">
              <div className={`text-[12px] font-semibold leading-tight sm:text-[15px] ${done || active ? 'text-pp-ink' : 'text-pp-muted'}`}>{s.title}</div>
              <div className="mt-0.5 hidden text-[13px] leading-snug text-pp-muted sm:block">{s.sub}</div>
            </div>
            <span className="sr-only">{done ? '(done)' : held ? '(stopped: needs a decision)' : active ? '(in progress)' : '(not yet)'}</span>
          </li>
        );
      })}
    </ol>
  );
}
