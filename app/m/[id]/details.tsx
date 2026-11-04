'use client';

import { useState, useSyncExternalStore } from 'react';
import type { Milestone } from '@/lib/escrow/types';
import { fmtDate, fmtMoney } from '@/app/components/status';
import { card, currentMinute, h2, noSubscribe } from './ui';

/** The PayPal side of the deal, with the real ids. */
export function PaymentDetails({ m, milestoneKey }: { m: Milestone; milestoneKey?: string | null }) {
  const p = m.payment;
  const rows: [string, string | undefined][] = [
    ['Order', p.orderId],
    ['Authorization', p.authorizationId && `${p.authorizationId} · ${p.authorizationStatus ?? ''}`],
    ['Reauthorized', p.reauthorizedAt && `${fmtDate(p.reauthorizedAt)} · was ${p.previousAuthorizationId}`],
    ['Honor period ends', p.honorExpiresAt && fmtDate(p.honorExpiresAt)],
    ['Authorization expires', p.expiresAt && fmtDate(p.expiresAt)],
    ['Releases', m.status === 'verified' && m.releaseAt ? fmtDate(m.releaseAt) : undefined],
    ['Deadline', m.dueAt && ['funded', 'reviewing', 'changes_requested', 'escalated'].includes(m.status) ? fmtDate(m.dueAt) : undefined],
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
          {p.reauthorizedAt ? 'The renewed' : 'The'} 3-day honor period ended on {fmtDate(p.honorExpiresAt!)}. PayPal may decline the capture; if it does, the hold stays and the client can fund again.
        </p>
      )}
      <dl className="mt-3 space-y-2 text-sm">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-3">
            <dt className="shrink-0 text-pp-muted">{k}</dt>
            {/* Ids wrap only where they must: break-all split "CREATED" and "UTC" mid-word on a phone. */}
            <dd suppressHydrationWarning className="min-w-0 font-mono text-xs leading-5 [overflow-wrap:anywhere] sm:text-right">{v}</dd>
          </div>
        ))}
        {!p.orderId && <p className="text-sm text-pp-muted">No PayPal order yet.</p>}
      </dl>
      {milestoneKey && m.payment.authorizationId && <DownloadRecord id={m.id} milestoneKey={milestoneKey} />}
      {!!m.paypalCalls?.length && (
        <details className="group mt-4 border-t border-pp-border pt-3">
          <summary className="cursor-pointer list-none text-xs font-semibold text-pp-blue">
            <span className="group-open:hidden">Show the {m.paypalCalls.length} PayPal API calls</span>
            <span className="hidden group-open:inline">PayPal API calls · each POST carries an idempotency key; PayPal&apos;s debug id finds the call on PayPal&apos;s side</span>
          </summary>
          <ol className="mt-3 space-y-2">
            {m.paypalCalls.map((c, i) => (
              <li key={i} className="rounded-lg bg-pp-canvas/70 px-3 py-2 font-mono text-[11px] leading-5">
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <b>{c.method}</b> {c.path}
                  </span>
                  <span className={c.status < 300 ? 'text-emerald-700' : 'text-pp-danger'}>{c.status}</span>
                </div>
                <div suppressHydrationWarning className="text-pp-muted">
                  {fmtDate(c.at)} · {c.ms} ms{c.requestId ? ` · PayPal-Request-Id ${c.requestId}` : ''}
                  {c.debugId ? ` · debug id ${c.debugId}` : ''}
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

/** The deal's whole record as a JSON file or the PDF PayPal gets in a dispute, for either party. */
export function DownloadRecord({ id, milestoneKey, pdf = false, className }: { id: string; milestoneKey: string; pdf?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/escrow/milestones/${id}/record${pdf ? '?format=pdf' : ''}`, { headers: { 'x-milestone-key': milestoneKey } });
          if (!res.ok) return;
          const url = URL.createObjectURL(await res.blob());
          const a = Object.assign(document.createElement('a'), { href: url, download: `proof-of-done-${id}.${pdf ? 'pdf' : 'json'}` });
          a.click();
          URL.revokeObjectURL(url);
        } finally {
          setBusy(false);
        }
      }}
      className={className ?? 'mt-4 w-full rounded-xl border border-pp-border px-3 py-2 text-left text-xs font-semibold text-pp-blue hover:border-pp-blue disabled:opacity-60'}
    >
      {busy ? 'Preparing…' : pdf ? 'Download the evidence PDF' : 'Download the full record (for a PayPal dispute)'}
      {!pdf && <span className="block font-normal text-pp-muted">Criteria, findings and evidence, the second opinion, every step, the PayPal ids and each file’s SHA-256</span>}
    </button>
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
      {m.seal?.head && <SealNote seal={m.seal} anchor={m.payment.anchoredRecord} />}
      <ol className="mt-4 space-y-3.5">
        {[...m.timeline].reverse().map((e, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ACTOR[e.actor]?.dot ?? 'bg-slate-300'}`} />
            <div className="min-w-0">
              <div className="leading-snug [overflow-wrap:anywhere]">{e.text}</div>
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

/** The timeline's hash chain (lib/escrow/chain.ts): its fingerprint, and whether every step still matches it. */
export function SealNote({ seal, anchor }: { seal: NonNullable<Milestone['seal']>; anchor?: string }) {
  return (
    <p className={`mt-3 rounded-xl px-3 py-2 text-xs leading-relaxed ring-1 ring-inset ${seal.intact ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-rose-50 text-pp-danger ring-rose-200'}`}>
      {seal.intact ? '✓ Sealed record: ' : '✗ This record was changed: '}
      {seal.intact
        ? `each of the ${seal.events} steps carries a SHA-256 of itself and the step before, so none can change unnoticed.`
        : `step ${(seal.brokenAt ?? 0) + 1} no longer matches its hash.`}{' '}
      Fingerprint <span className="break-all font-mono">{seal.head.slice(0, 16)}…</span>
      {anchor && (
        <>
          {' '}· PayPal&apos;s capture note holds <span className="font-mono">{anchor.slice(0, 16)}</span>
        </>
      )}
    </p>
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
            {s.notes && <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">{s.notes}</p>}
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
