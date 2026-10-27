'use client';

import { useSyncExternalStore } from 'react';
import type { Milestone } from '@/lib/escrow/types';
import { fmtDate, fmtMoney } from '@/app/components/status';
import { card, currentMinute, h2, noSubscribe } from './ui';

/** The PayPal side of the deal, with the real ids. */
export function PaymentDetails({ m }: { m: Milestone }) {
  const p = m.payment;
  const rows: [string, string | undefined][] = [
    ['Order', p.orderId],
    ['Authorization', p.authorizationId && `${p.authorizationId} · ${p.authorizationStatus ?? ''}`],
    ['Honor period ends', p.honorExpiresAt && fmtDate(p.honorExpiresAt)],
    ['Authorization expires', p.expiresAt && fmtDate(p.expiresAt)],
    ['Releases', m.status === 'verified' && m.releaseAt ? fmtDate(m.releaseAt) : undefined],
    ['Capture', p.captureId && (p.capturedAmount ? `${p.captureId} · ${fmtMoney(p.capturedAmount, m.currency)} of ${fmtMoney(m.amount, m.currency)}` : p.captureId)],
    ['Payout', p.payoutBatchId ? `${p.payoutBatchId} · ${p.payoutStatus}` : p.payoutStatus],
    ['Voided', p.voidedAt && fmtDate(p.voidedAt)],
  ];
  // PayPal only guarantees the funds for 3 days; capturing later can fail.
  const minute = useSyncExternalStore(noSubscribe, currentMinute, () => 0);
  const honorPassed = minute > 0 && p.honorExpiresAt && !p.captureId && !p.voidedAt && new Date(p.honorExpiresAt).getTime() < minute * 60_000;
  return (
    <section className={card}>
      <div className="flex items-center justify-between">
        <h2 className={h2}>PayPal</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${p.mode === 'sandbox' ? 'bg-blue-50 text-pp-blue ring-blue-200' : 'bg-slate-100 text-slate-600 ring-slate-300'}`}>
          {p.mode === 'sandbox' ? 'sandbox · real API' : 'simulated'}
        </span>
      </div>
      {honorPassed && (
        <p suppressHydrationWarning className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          The 3-day honor period ended on {fmtDate(p.honorExpiresAt!)}. PayPal may decline the capture; if it does, the hold stays and the client can fund again.
        </p>
      )}
      <dl className="mt-3 space-y-2 text-sm">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-pp-muted">{k}</dt>
            <dd suppressHydrationWarning className="min-w-0 break-all text-right font-mono text-xs leading-5">{v}</dd>
          </div>
        ))}
        {!p.orderId && <p className="text-sm text-pp-muted">No PayPal order yet.</p>}
      </dl>
    </section>
  );
}

const ACTOR: Record<string, { label: string; dot: string }> = {
  client: { label: 'Client', dot: 'bg-slate-500' },
  freelancer: { label: 'Freelancer', dot: 'bg-amber-500' },
  agent: { label: 'AI reviewer', dot: 'bg-violet-500' },
  paypal: { label: 'PayPal', dot: 'bg-pp-blue' },
  system: { label: 'System', dot: 'bg-slate-300' },
};

export function Timeline({ m }: { m: Milestone }) {
  return (
    <details className={`${card} group`} open>
      <summary className="flex cursor-pointer list-none items-center justify-between">
        <h2 className={h2}>Timeline · who did what</h2>
        <span className="text-xs text-pp-muted group-open:hidden">{m.timeline.length} events · show</span>
      </summary>
      <ol className="mt-4 space-y-3.5">
        {[...m.timeline].reverse().map((e, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ACTOR[e.actor]?.dot ?? 'bg-slate-300'}`} />
            <div className="min-w-0">
              <div className="leading-snug">{e.text}</div>
              <div suppressHydrationWarning className="mt-0.5 text-xs text-pp-muted">
                {ACTOR[e.actor]?.label ?? e.actor} · {fmtDate(e.at)}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function Submissions({ m, fileKey }: { m: Milestone; fileKey: string | null }) {
  const fileUrl = (file: string) => `/api/escrow/files/${file}?key=${encodeURIComponent(fileKey ?? '')}`;
  if (!m.submissions.length) return null;
  return (
    <section className={card}>
      <h2 className={h2}>What was delivered</h2>
      <ul className="mt-4 space-y-5">
        {[...m.submissions].reverse().map((s) => (
          <li key={s.id} className="text-sm">
            <div suppressHydrationWarning className="text-xs text-pp-muted">{fmtDate(s.at)}</div>
            {s.notes && <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{s.notes}</p>}
            {s.links.map((l) => (
              <a key={l} href={l} target="_blank" rel="noreferrer" className="mt-1 block truncate text-pp-blue hover:underline">
                {l}
              </a>
            ))}
            <div className="mt-2 flex flex-wrap gap-2">
              {s.attachments.map((a) =>
                ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(a.mime) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={a.id} src={fileUrl(a.file)} alt={a.name} className="h-24 rounded-lg border border-pp-border object-cover" />
                ) : (
                  <a key={a.id} href={fileUrl(a.file)} className="flex items-center gap-2 rounded-lg border border-pp-border px-3 py-2 text-xs font-medium hover:border-pp-blue">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-pp-muted" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" /></svg>
                    {a.name}
                  </a>
                ),
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
