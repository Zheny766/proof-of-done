'use client';

import { useEffect, useRef } from 'react';
import type { AgentLogEntry, Audit, CriterionFinding, Milestone, Role } from '@/lib/escrow/types';
import { latestFindings } from '@/lib/escrow/policy';
import { fmtMoney } from '@/app/components/status';
import { card, h2, modelName } from './ui';

const seconds = (from: string, to: string) => Math.max(1, Math.round((+new Date(to) - +new Date(from)) / 1000));

/** The criteria with the reviewer's findings, the second opinion and what was decided. */
export function Verdict({ m }: { m: Milestone }) {
  const review = m.reviews.at(-1);
  const findings = review ? latestFindings(m.criteria, review.findings) : m.criteria.map(() => undefined);
  const who =
    review?.engine === 'claude'
      ? modelName(review.model)
      : review?.engine === 'replay'
        ? `Replay of a real ${modelName(review.model)} run`
        : review
          ? 'Simulated reviewer'
          : null;
  return (
    <section className={card} aria-labelledby="verdict-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="verdict-title" className="font-display text-2xl text-pp-navy">
          {review ? 'The verdict' : 'What has to be true to get paid'}
        </h2>
        {review && (
          <span className="text-xs text-pp-muted">
            {who}
            {review.audit?.engine === 'claude' && ` · second opinion ${modelName(review.audit.model)}`}
            {review.finishedAt && ` · ${seconds(review.startedAt, review.finishedAt)} s`}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-pp-muted">
        Every criterion has to be met with at least {Math.round(m.releaseThreshold * 100)}% confidence, and a second model has to agree, before any money moves.
      </p>
      <ul className="mt-5 space-y-3">
        {m.criteria.map((c, i) => (
          <CriterionRow key={c.id} n={i + 1} text={c.text} finding={findings[i]} pending={m.status === 'reviewing' && !findings[i]} threshold={m.releaseThreshold} />
        ))}
      </ul>
      {review?.audit && <SecondOpinion audit={review.audit} m={m} />}
      {review?.finishedAt && <DecisionBanner m={m} />}
    </section>
  );
}

function CriterionRow({ n, text, finding, pending, threshold }: { n: number; text: string; finding?: CriterionFinding; pending: boolean; threshold: number }) {
  // "met" but under the threshold doesn't count for release, so don't paint it green.
  const clears = finding?.status === 'met' && finding.confidence >= threshold;
  const tone = !finding
    ? 'bg-slate-100 text-slate-400'
    : clears
      ? 'bg-emerald-500 text-white'
      : finding.status === 'not_met'
        ? 'bg-rose-500 text-white'
        : 'bg-amber-400 text-white';
  const pct = finding ? Math.round(finding.confidence * 100) : 0;
  const label = !finding ? (pending ? 'Checking' : 'Not checked yet') : finding.status === 'met' ? (clears ? 'Met' : 'Met, below the threshold') : finding.status === 'not_met' ? 'Not met' : 'Unclear';
  return (
    <li className="rounded-xl border border-pp-border/70 bg-pp-canvas/40 p-4">
      <div className="flex gap-3">
        <span aria-hidden className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${tone} ${pending ? 'animate-pulse' : ''}`}>
          {!finding ? n : clears ? '✓' : finding.status === 'not_met' ? '✕' : '?'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <span className="text-[15px] font-medium leading-snug text-pp-ink">{text}</span>
            <span className={`shrink-0 text-xs font-semibold ${!finding ? 'text-pp-muted' : clears ? 'text-emerald-700' : finding.status === 'not_met' ? 'text-pp-danger' : 'text-amber-700'}`}>
              {label}
              {finding && ` · ${pct}%`}
            </span>
          </div>
          {finding && (
            <>
              <div className="relative mt-2 h-1.5 rounded-full bg-slate-200" title={`release threshold ${Math.round(threshold * 100)}%`}>
                <div className={`h-full rounded-full ${clears ? 'bg-emerald-500' : finding.status === 'not_met' ? 'bg-rose-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
                <div className="absolute -top-1 h-3.5 w-0.5 rounded bg-pp-navy" style={{ left: `${threshold * 100}%` }} />
              </div>
              <p className="mt-2 border-l-2 border-slate-300 pl-3 text-[13px] leading-relaxed text-pp-muted">{finding.evidence}</p>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

// A second model has to confirm a release before any money moves.
function SecondOpinion({ audit, m }: { audit: Audit; m: Milestone }) {
  const who = audit.engine === 'claude' ? modelName(audit.model) : 'simulated check';
  const text = (id: string) => m.criteria.find((c) => c.id === id)?.text ?? id;
  return (
    <div className={`mt-4 rounded-xl px-4 py-3.5 text-sm ring-1 ring-inset ${audit.agreed ? 'bg-violet-50/70 ring-violet-200' : 'bg-orange-50 ring-orange-200'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`font-semibold ${audit.agreed ? 'text-violet-900' : 'text-orange-900'}`}>
          {audit.agreed ? 'Second opinion: confirmed every criterion' : 'Second opinion: did not confirm the release'}
        </span>
        <span className="text-xs text-pp-muted">{who}</span>
      </div>
      {!audit.agreed && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-orange-900">
          {audit.disputed.map((d) => (
            <li key={d.criterionId}>
              {text(d.criterionId)}
              {d.reason && `: ${d.reason}`}
            </li>
          ))}
          {audit.redFlags.map((r, i) => (
            <li key={i}>Red flag: {r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Follows the milestone's status, not just the reviewer's decision: after an escalation the
// client may have paid, asked for changes or cancelled.
function DecisionBanner({ m }: { m: Milestone }) {
  const review = m.reviews.at(-1);
  const byAgent = review?.decision;
  const aiReleased = m.timeline.some((e) => e.type === 'verified');
  const settled = m.payment.capturedAmount;
  const banners: Partial<Record<Milestone['status'], [string, string]>> = {
    released: [
      settled
        ? `Settled · ${fmtMoney(settled, m.currency)} paid, ${fmtMoney(Number(m.amount) - Number(settled), m.currency)} back to the client`
        : aiReleased
          ? 'Verified · payment released'
          : 'Approved by the client · payment released',
      'bg-emerald-50 text-emerald-900 ring-emerald-200',
    ],
    verified: ['Verified · the payment goes out when the objection window closes', 'bg-teal-50 text-teal-900 ring-teal-200'],
    changes_requested: ['Changes requested · the money stays on hold', 'bg-amber-50 text-amber-900 ring-amber-200'],
    escalated: ['Escalated · the client decides', 'bg-orange-50 text-orange-900 ring-orange-200'],
    cancelled: ['Cancelled · nothing was charged', 'bg-rose-50 text-rose-900 ring-rose-200'],
  };
  const banner = banners[m.status];
  if (!banner) return null;
  const [title, tone] = banner;
  // The reviewer's own words only fit if the outcome is still its decision.
  const agentOutcome = { release: ['released', 'verified'], request_changes: ['changes_requested'], escalate: ['escalated'] } as const;
  const summary = byAgent && (agentOutcome[byAgent] as readonly string[]).includes(m.status) && !settled ? review?.summary : undefined;
  const feedback = m.status === 'changes_requested' || m.status === 'escalated' ? review?.feedback : undefined;
  return (
    <div className={`mt-4 rounded-xl p-4 ring-1 ring-inset ${tone}`}>
      <div className="text-[15px] font-semibold">{title}</div>
      {summary && <p className="mt-1 text-sm">{summary}</p>}
      {feedback && <pre className="mt-2 whitespace-pre-wrap font-[inherit] text-sm">{feedback}</pre>}
    </div>
  );
}

const LOG_TAG: Record<AgentLogEntry['kind'], string> = { thinking: 'note', tool: 'tool', result: 'finding', decision: 'decision', error: 'error', info: 'info' };

/** Every step the reviewer took. Open while it works, folded once it's done. */
export function AgentLog({ entries, live, role, reviewed }: { entries: AgentLogEntry[]; live: boolean; role: Role; reviewed: boolean }) {
  // Keep the newest entry in view by scrolling the log box itself, never the page.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [entries.length]);
  return (
    <details className={`${card} group`} open={live || undefined}>
      <summary className="flex cursor-pointer list-none items-center justify-between">
        <h2 className={h2}>How the AI decided · audit log</h2>
        <span className="flex items-center gap-3">
          {live && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-violet-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-violet-600" />
              live
            </span>
          )}
          <span className="text-xs text-pp-muted group-open:hidden">{entries.length ? `${entries.length} steps · show` : 'show'}</span>
        </span>
      </summary>
      {role === 'viewer' && reviewed ? (
        <p className="mt-3 text-sm text-pp-muted">The reviewer&apos;s log and evidence are visible to the client and the freelancer.</p>
      ) : entries.length === 0 ? (
        <p className="mt-3 text-sm text-pp-muted">Every step the reviewer takes - what it opened, what it found, why it decided - is recorded here.</p>
      ) : (
        <div ref={box} aria-live="polite" className="mt-4 max-h-96 space-y-2.5 overflow-y-auto pr-1">
          {entries.map((e, i) => (
            <div key={i} className="flex gap-3 text-sm">
              <span className="w-16 shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-wide text-pp-muted">{LOG_TAG[e.kind]}</span>
              <span className={e.kind === 'decision' ? 'font-semibold' : e.kind === 'error' ? 'text-pp-danger' : 'text-pp-ink'}>{e.text}</span>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
