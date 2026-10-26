'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentLogEntry, CriterionFinding, Milestone } from '@/lib/escrow/types';
import { latestFindings } from '@/lib/escrow/policy';
import { api, fmtDate, fmtMoney, STATUS, StatusBadge } from '@/app/components/status';
import { PayPalFundButton } from '@/app/components/paypal-fund-button';

const card = 'rounded-xl border border-pp-border bg-white p-5 shadow-sm';
const h2 = 'text-xs font-semibold uppercase tracking-wider text-pp-muted';

export function MilestoneView({ initial, paypalClientId }: { initial: Milestone; paypalClientId: string | null }) {
  const [m, setM] = useState(initial);

  const refresh = useCallback(async () => {
    const { milestone } = await api<{ milestone: Milestone }>(`/api/escrow/milestones/${initial.id}`);
    setM(milestone);
  }, [initial.id]);

  // Poll while the AI reviewer is working so findings and log lines appear live.
  useEffect(() => {
    if (m.status !== 'reviewing') return;
    const t = setInterval(() => refresh().catch(() => {}), 1200);
    return () => clearInterval(t);
  }, [m.status, refresh]);

  const review = m.reviews.at(-1);
  const findings = review ? latestFindings(m.criteria, review.findings) : m.criteria.map(() => undefined);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-pp-navy">{m.title}</h1>
            <StatusBadge status={m.status} />
          </div>
          <p className="mt-1 text-sm text-pp-muted">
            {m.client.name} pays {m.freelancer.name} · {STATUS[m.status].hint}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold tabular-nums text-pp-navy">{fmtMoney(m.amount, m.currency)}</div>
          <div className="text-xs text-pp-muted">release threshold {Math.round(m.releaseThreshold * 100)}% per criterion</div>
        </div>
      </div>

      <MoneyFlow m={m} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-6">
          {m.status === 'awaiting_funding' && (
            <section className={card}>
              <h2 className={h2}>Step 1 · Client funds the milestone</h2>
              <p className="mb-4 mt-2 text-sm">Approve {fmtMoney(m.amount, m.currency)} with PayPal. It is held, not charged, until the work is verified.</p>
              <PayPalFundButton milestoneId={m.id} clientId={paypalClientId} onFunded={refresh} />
            </section>
          )}

          {(m.status === 'funded' || m.status === 'changes_requested') && <SubmitWork m={m} onSubmitted={setM} />}

          {['funded', 'escalated', 'changes_requested'].includes(m.status) && <ClientDecision m={m} onChange={setM} />}

          <PaymentDetails m={m} />
          <Timeline m={m} />
        </div>

        <div className="space-y-6">
          <section className={card}>
            <div className="flex items-center justify-between">
              <h2 className={h2}>Acceptance criteria</h2>
              {review && (
                <span className="text-xs text-pp-muted">
                  {review.engine === 'claude' ? `Claude · ${review.model}` : 'Simulated reviewer'}
                  {review.finishedAt && ` · ${Math.max(1, Math.round((+new Date(review.finishedAt) - +new Date(review.startedAt)) / 1000))}s`}
                </span>
              )}
            </div>
            <ul className="mt-3 divide-y divide-pp-border">
              {m.criteria.map((c, i) => (
                <CriterionRow key={c.id} text={c.text} finding={findings[i]} pending={m.status === 'reviewing' && !findings[i]} threshold={m.releaseThreshold} />
              ))}
            </ul>
            {review?.decision && <DecisionBanner decision={review.decision} summary={review.summary} feedback={review.feedback} />}
          </section>

          <AgentLog entries={review?.log ?? []} live={m.status === 'reviewing'} />
          <Submissions m={m} />
        </div>
      </div>
    </main>
  );
}

function MoneyFlow({ m }: { m: Milestone }) {
  const stage =
    m.status === 'awaiting_funding' ? 0 : m.status === 'released' ? 3 : m.status === 'cancelled' ? -1 : m.status === 'reviewing' ? 2 : 1;
  // A client can approve and pay without an AI review; don't show that step as done then.
  const aiSkipped = m.status === 'released' && !m.timeline.some((e) => e.type === 'verified');
  const steps = [
    { label: 'Client funds', sub: m.client.name },
    { label: 'PayPal holds funds', sub: m.payment.authorizationId ? `auth ${m.payment.authorizationId.slice(0, 14)}…` : 'authorize intent' },
    { label: 'AI verifies the work', sub: aiSkipped ? 'skipped: client approved' : `${m.criteria.length} criteria` },
    { label: 'Freelancer paid', sub: m.payment.captureId ? `capture ${m.payment.captureId.slice(0, 14)}…` : m.freelancer.name },
  ];
  return (
    <ol className="mt-6 grid grid-cols-4 gap-2 rounded-xl border border-pp-border bg-white p-3">
      {steps.map((s, i) => {
        const skipped = aiSkipped && i === 2;
        const done = (stage > i || stage === 3) && !skipped;
        const active = stage === i;
        return (
          <li key={s.label} className={`rounded-lg px-3 py-2 ${done ? 'bg-emerald-50' : active ? 'bg-pp-highlight ring-1 ring-pp-blue' : stage === -1 ? 'bg-rose-50/40' : 'bg-slate-50'}`}>
            <div className={`text-xs font-bold ${done ? 'text-emerald-700' : active ? 'text-pp-blue' : 'text-pp-muted'}`}>
              {done ? '✓' : skipped ? '–' : `${i + 1}.`} {s.label}
            </div>
            <div className="truncate text-[11px] text-pp-muted">{s.sub}</div>
          </li>
        );
      })}
    </ol>
  );
}

function CriterionRow({ text, finding, pending, threshold }: { text: string; finding?: CriterionFinding; pending: boolean; threshold: number }) {
  const icon = !finding ? (pending ? '⟳' : '○') : finding.status === 'met' ? '✓' : finding.status === 'not_met' ? '✕' : '?';
  // "met" but under the threshold doesn't count for release, so don't paint it green.
  const clears = finding?.status === 'met' && finding.confidence >= threshold;
  const tone = !finding ? 'text-pp-muted' : clears ? 'text-emerald-600' : finding.status === 'not_met' ? 'text-pp-danger' : 'text-amber-600';
  const pct = finding ? Math.round(finding.confidence * 100) : 0;
  return (
    <li className="flex gap-3 py-3">
      <span className={`mt-0.5 w-5 text-center text-lg font-bold leading-5 ${tone} ${pending ? 'animate-spin' : ''}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{text}</div>
        {finding && (
          <>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="relative h-1.5 w-32 rounded-full bg-slate-200">
                <div className={`h-full rounded-full ${clears ? 'bg-emerald-500' : finding.status === 'not_met' ? 'bg-rose-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                <div className="absolute -top-0.5 h-2.5 w-px bg-pp-navy" style={{ left: `${threshold * 100}%` }} title="release threshold" />
              </div>
              <span className="text-xs tabular-nums text-pp-muted">
                {pct}% confident{finding.status === 'met' && !clears ? ` · below the ${Math.round(threshold * 100)}% threshold` : ''}
              </span>
            </div>
            <p className="mt-1 text-xs text-pp-muted">{finding.evidence}</p>
          </>
        )}
      </div>
    </li>
  );
}

function DecisionBanner({ decision, summary, feedback }: { decision: string; summary?: string; feedback?: string }) {
  const map: Record<string, [string, string]> = {
    release: ['Verified · payment released', 'bg-emerald-50 text-emerald-900 ring-emerald-200'],
    request_changes: ['Changes requested · money stays on hold', 'bg-amber-50 text-amber-900 ring-amber-200'],
    escalate: ['Escalated · the client decides', 'bg-orange-50 text-orange-900 ring-orange-200'],
  };
  const [title, tone] = map[decision] ?? ['Decision', 'bg-slate-50'];
  return (
    <div className={`mt-4 rounded-lg p-4 ring-1 ring-inset ${tone}`}>
      <div className="text-sm font-bold">{title}</div>
      {summary && <p className="mt-1 text-sm">{summary}</p>}
      {feedback && <pre className="mt-2 whitespace-pre-wrap font-[inherit] text-sm">{feedback}</pre>}
    </div>
  );
}

const LOG_TAG: Record<AgentLogEntry['kind'], string> = { thinking: 'note', tool: 'tool', result: 'finding', decision: 'decision', error: 'error', info: 'info' };

function AgentLog({ entries, live }: { entries: AgentLogEntry[]; live: boolean }) {
  // Keep the newest entry in view by scrolling the log box itself, never the page.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [entries.length]);
  return (
    <section className={card}>
      <div className="flex items-center justify-between">
        <h2 className={h2}>AI reviewer · audit log</h2>
        {live && <span className="flex items-center gap-1.5 text-xs font-semibold text-violet-700"><span className="h-2 w-2 animate-pulse rounded-full bg-violet-600" />live</span>}
      </div>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-pp-muted">Every step the reviewer takes - what it opened, what it found, why it decided - is recorded here.</p>
      ) : (
        <div ref={box} className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
          {entries.map((e, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span className="w-14 shrink-0 pt-0.5 font-mono text-[10px] uppercase text-pp-muted">{LOG_TAG[e.kind]}</span>
              <span className={e.kind === 'decision' ? 'font-semibold' : e.kind === 'error' ? 'text-pp-danger' : 'text-pp-ink'}>{e.text}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SubmitWork({ m, onSubmitted }: { m: Milestone; onSubmitted: (m: Milestone) => void }) {
  const [notes, setNotes] = useState('');
  const [links, setLinks] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resubmit = m.status === 'changes_requested';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData();
    fd.set('notes', notes);
    fd.set('links', links);
    files.forEach((f) => fd.append('files', f));
    try {
      const { milestone } = await api<{ milestone: Milestone }>(`/api/escrow/milestones/${m.id}/submit`, { method: 'POST', body: fd });
      onSubmitted(milestone);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={card}>
      <h2 className={h2}>{resubmit ? 'Freelancer · resubmit the work' : 'Step 2 · Freelancer submits the work'}</h2>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What you delivered and how it meets each criterion…" className="h-28 w-full rounded-md border border-pp-border px-3 py-2 text-sm outline-none focus:border-pp-blue" />
        <input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="Links (live site, repo, files) - space separated" className="h-10 w-full rounded-md border border-pp-border px-3 text-sm outline-none focus:border-pp-blue" />
        <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-pp-border bg-pp-canvas px-3 py-4 text-sm text-pp-muted hover:border-pp-blue">
          <input type="file" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} accept="image/*,.pdf,.txt,.md,.csv,.json,.html,.js,.ts,.py" />
          {files.length ? files.map((f) => f.name).join(', ') : 'Attach screenshots, PDFs or files (optional)'}
        </label>
        {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-pp-danger">{error}</p>}
        <button disabled={busy} className="h-11 w-full rounded-full bg-pp-navy text-sm font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-60">
          {busy ? 'Submitting…' : 'Submit for AI verification'}
        </button>
      </form>
    </section>
  );
}

function ClientDecision({ m, onChange }: { m: Milestone; onChange: (m: Milestone) => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function act(action: 'approve' | 'request_changes' | 'cancel') {
    setBusy(action);
    setError('');
    try {
      const { milestone } = await api<{ milestone: Milestone }>(`/api/escrow/milestones/${m.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note }),
      });
      onChange(milestone);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <section className={`${card} ${m.status === 'escalated' ? 'ring-2 ring-orange-300' : ''}`}>
      <h2 className={h2}>Client · always has the final say</h2>
      {m.status === 'escalated' && <p className="mt-2 text-sm text-orange-900">The reviewer could not verify everything on its own. Check its notes and decide.</p>}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note to the freelancer" className="mt-3 h-10 w-full rounded-md border border-pp-border px-3 text-sm outline-none focus:border-pp-blue" />
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button onClick={() => act('approve')} disabled={!!busy} className="h-10 rounded-full bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{busy === 'approve' ? '…' : 'Approve & pay'}</button>
        <button onClick={() => act('request_changes')} disabled={!!busy || m.status !== 'escalated'} title={m.status === 'escalated' ? undefined : 'Available once a submission has been reviewed'} className="h-10 rounded-full border border-amber-400 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50">Ask for changes</button>
        <button onClick={() => act('cancel')} disabled={!!busy} className="h-10 rounded-full border border-rose-300 text-xs font-semibold text-pp-danger hover:bg-rose-50 disabled:opacity-50">{busy === 'cancel' ? '…' : 'Cancel & void'}</button>
      </div>
      {error && <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-pp-danger">{error}</p>}
    </section>
  );
}

function PaymentDetails({ m }: { m: Milestone }) {
  const p = m.payment;
  const rows: [string, string | undefined][] = [
    ['Mode', p.mode === 'sandbox' ? 'PayPal sandbox (real API calls)' : 'Simulated (no PayPal credentials)'],
    ['Order', p.orderId],
    ['Authorization', p.authorizationId && `${p.authorizationId} · ${p.authorizationStatus ?? ''}`],
    ['Honor period ends', p.honorExpiresAt && fmtDate(p.honorExpiresAt)],
    ['Authorization expires', p.expiresAt && fmtDate(p.expiresAt)],
    ['Capture', p.captureId],
    ['Payout', p.payoutBatchId ? `${p.payoutBatchId} · ${p.payoutStatus}` : p.payoutStatus],
    ['Voided', p.voidedAt && fmtDate(p.voidedAt)],
  ];
  return (
    <section className={card}>
      <h2 className={h2}>PayPal</h2>
      <dl className="mt-3 space-y-1.5 text-sm">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-pp-muted">{k}</dt>
            <dd suppressHydrationWarning className="truncate text-right font-mono text-xs leading-5">{v}</dd>
          </div>
        ))}
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

function Timeline({ m }: { m: Milestone }) {
  return (
    <section className={card}>
      <h2 className={h2}>Timeline</h2>
      <ol className="mt-3 space-y-3">
        {[...m.timeline].reverse().map((e, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ACTOR[e.actor]?.dot ?? 'bg-slate-300'}`} />
            <div>
              <div>{e.text}</div>
              <div suppressHydrationWarning className="text-xs text-pp-muted">
                {ACTOR[e.actor]?.label ?? e.actor} · {fmtDate(e.at)}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Submissions({ m }: { m: Milestone }) {
  if (!m.submissions.length) return null;
  return (
    <section className={card}>
      <h2 className={h2}>Submissions</h2>
      <ul className="mt-3 space-y-4">
        {[...m.submissions].reverse().map((s) => (
          <li key={s.id} className="text-sm">
            <div suppressHydrationWarning className="text-xs text-pp-muted">{fmtDate(s.at)}</div>
            {s.notes && <p className="mt-1 whitespace-pre-wrap">{s.notes}</p>}
            {s.links.map((l) => (
              <a key={l} href={l} target="_blank" rel="noreferrer" className="mt-1 block truncate text-pp-blue hover:underline">{l}</a>
            ))}
            <div className="mt-2 flex flex-wrap gap-2">
              {s.attachments.map((a) =>
                a.mime.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={a.id} src={`/api/escrow/files/${a.file}`} alt={a.name} className="h-20 rounded border border-pp-border object-cover" />
                ) : (
                  <a key={a.id} href={`/api/escrow/files/${a.file}`} className="rounded border border-pp-border px-2 py-1 text-xs hover:border-pp-blue">{a.name}</a>
                ),
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
