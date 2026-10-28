'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Milestone, Role } from '@/lib/escrow/types';
import type { StageSummary } from '@/lib/escrow/service';
import { api, fmtMoney, keyHeader, STATUS, StatusBadge } from '@/app/components/status';
import { AfterPayment, NextStep, Settlement, ShareLink } from './actions';
import { PaymentDetails, Submissions, Timeline } from './details';
import { MoneyJourney } from './journey';
import { card, h2, initials } from './ui';
import { AgentLog, Verdict } from './verdict';
import { describeDeal } from '@/app/components/deal-facts';
import { WebMcpTools, type WebMcpTool } from '@/app/components/webmcp';

type Party = Exclude<Role, 'viewer'>;
type SavedKeys = { client?: string; freelancer?: string; share?: string };

// Keys from links opened in this browser, so the milestone still works when reopened from the list.
const storageKey = (id: string) => `pod:keys:${id}`;
const KEYS_CHANGED = 'pod:keys-changed';

function readStored(id: string): string | null {
  try {
    return localStorage.getItem(storageKey(id));
  } catch {
    return null; // storage blocked (private mode): the link in the address bar still works
  }
}

function parseKeys(raw: string | null): SavedKeys {
  try {
    return raw ? (JSON.parse(raw) as SavedKeys) : {};
  } catch {
    return {};
  }
}

function forgetKey(id: string, role: Party) {
  try {
    const saved = parseKeys(readStored(id));
    delete saved[role];
    if (role === 'client') delete saved.share;
    localStorage.setItem(storageKey(id), JSON.stringify(saved));
    window.dispatchEvent(new Event(KEYS_CHANGED));
  } catch {}
}

/** Adds keys to what this browser already has for the milestone (never drops the other party's key). */
function saveKeys(id: string, add: SavedKeys) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify({ ...parseKeys(readStored(id)), ...add }));
    window.dispatchEvent(new Event(KEYS_CHANGED));
  } catch {}
}

function subscribeKeys(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(KEYS_CHANGED, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(KEYS_CHANGED, onChange);
  };
}

export function MilestoneView({
  initial,
  link,
  freelancerKey,
  paypalClientId,
  initialStages,
}: {
  initial: Milestone;
  link: { role: Party; key: string } | null;
  freelancerKey: string | null;
  paypalClientId: string | null;
  initialStages: StageSummary[] | null;
}) {
  const [m, setM] = useState(initial);
  const [stages, setStages] = useState(initialStages);
  const [chosen, setChosen] = useState<Party | null>(null);

  const stored = useSyncExternalStore(subscribeKeys, () => readStored(initial.id), () => null);
  const fromLink = useMemo<SavedKeys>(
    () => ({ ...(link && { [link.role]: link.key }), ...(freelancerKey && { share: freelancerKey }) }),
    [link, freelancerKey],
  );
  const keys = useMemo<SavedKeys>(() => ({ ...parseKeys(stored), ...fromLink }), [stored, fromLink]);

  const stageIds = initial.project?.stageIds;
  useEffect(() => {
    if (!link) return;
    saveKeys(initial.id, fromLink);
    // A project's stages share the two links, so the same keys open every stage.
    for (const sid of stageIds ?? []) if (sid !== initial.id) saveKeys(sid, fromLink);
    // Keep the key out of the address bar (and out of screenshots and recordings).
    window.history.replaceState(null, '', `/m/${initial.id}`);
  }, [initial.id, link, fromLink, stageIds]);

  const role: Role = chosen ?? link?.role ?? (keys.client ? 'client' : keys.freelancer ? 'freelancer' : 'viewer');
  const key = role === 'viewer' ? null : (keys[role] ?? null);

  const refresh = useCallback(async () => {
    const res = await api<{ milestone: Milestone; role: Role; stages: StageSummary[] | null }>(`/api/escrow/milestones/${initial.id}`, { headers: keyHeader(key) });
    // A saved key the server no longer accepts (e.g. the data was reset): drop it.
    if (key && res.role === 'viewer' && role !== 'viewer') forgetKey(initial.id, role);
    setM(res.milestone);
    setStages(res.stages);
  }, [initial.id, key, role]);

  // Opened without a key in the link (e.g. from the list) but this browser has one: the server
  // rendered the redacted view, so fetch the full one.
  useEffect(() => {
    if (link || !key) return;
    let alive = true;
    api<{ milestone: Milestone; role: Role }>(`/api/escrow/milestones/${initial.id}`, { headers: keyHeader(key) })
      .then((res) => {
        if (!alive) return;
        if (res.role === 'viewer' && role !== 'viewer') forgetKey(initial.id, role);
        else setM(res.milestone);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [initial.id, link, key, role]);

  // Fast while the reviewer works (findings appear live), slower otherwise so the other party's
  // actions show up without a reload. Stops once nothing can change any more.
  const settled = m.status === 'cancelled' || (m.status === 'released' && !['PENDING', 'PROCESSING'].includes(m.payment.payoutStatus ?? ''));
  useEffect(() => {
    if (settled) return;
    const tick = () => {
      if (!document.hidden) refresh().catch(() => {});
    };
    const t = setInterval(tick, m.status === 'reviewing' ? 1200 : 5000);
    // Coming back to the tab: catch up right away instead of on the next tick.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [m.status, settled, refresh]);

  const review = m.reviews.at(-1);
  const refunded = (m.payment.refunds ?? []).filter((r) => r.status !== 'FAILED' && r.status !== 'CANCELLED').reduce((sum, r) => sum + Number(r.amount), 0);
  const both = !!(keys.client && keys.freelancer);
  // A later stage is funded only once the one before it is paid (or cancelled).
  const before = m.project && m.project.stage > 1 ? stages?.[m.project.stage - 2] : undefined;
  const waitForStage = before && !['released', 'cancelled'].includes(before.status) ? before.stage : null;
  const canSettle = role !== 'viewer' && ['changes_requested', 'escalated'].includes(m.status);
  const settleFirst = canSettle && m.demo?.scenario === 'partial';
  // For AI agents in the browser (WebMCP): what this page shows, read-only.
  const latest = useRef(m);
  useEffect(() => {
    latest.current = m;
  }, [m]);
  const agentTools = useMemo<WebMcpTool[]>(
    () => [
      {
        name: 'deal_status',
        description: 'Where this escrow deal stands: amount, status, the AI verdict on each criterion, the second opinion, the PayPal state and the latest events.',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => describeDeal(latest.current),
      },
    ],
    [],
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-16 pt-8">
      <WebMcpTools tools={agentTools} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={m.status} />
            {!!refunded && (
              <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-800 ring-1 ring-inset ring-orange-200">Refunded {fmtMoney(refunded, m.currency)}</span>
            )}
            {m.complaint?.status === 'open' && <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-800 ring-1 ring-inset ring-orange-200">Problem reported</span>}
            {m.objectionHours ? <span className="text-xs text-pp-muted">{m.objectionHours} h objection window</span> : null}
          </div>
          <h1 className="mt-2 font-display text-4xl leading-tight text-pp-navy sm:text-[44px]">{m.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-pp-muted">
            <Person name={m.client.name} tone="bg-pp-navy text-white" />
            <span>pays</span>
            <Person name={m.freelancer.name} tone="bg-amber-400 text-amber-950" />
            {m.postedBy && <span className="text-xs">· posted by {m.postedBy}</span>}
          </div>
          <p className="mt-2 text-sm text-pp-muted">{STATUS[m.status].hint}</p>
        </div>
        <div className="shrink-0 sm:text-right">
          <div className="font-display text-5xl tabular-nums text-pp-navy">{fmtMoney(m.amount, m.currency)}</div>
          <div className="mt-1 text-xs text-pp-muted">AI needs {Math.round(m.releaseThreshold * 100)}% confidence on every criterion</div>
        </div>
      </div>

      {m.demo && m.demo.scenario !== 'board' && <DemoGuide m={m} role={role} />}

      {m.project && stages && <ProjectStages m={m} stages={stages} />}

      {!!m.disputes?.length && (
        <div role="alert" className="mt-6 rounded-2xl border border-rose-300 bg-rose-50 px-5 py-4 text-[15px] text-rose-950">
          {m.disputes.map((d) => (
            <p key={d.id}>
              <b>PayPal dispute {d.id}</b> · {d.reason}
              {d.amount && ` · ${d.amount}`} · {d.status.toLowerCase().replace(/_/g, ' ')}
            </p>
          ))}
          <p className="mt-1 text-sm text-rose-900">
            The buyer disputed this payment with PayPal. {role === 'viewer' ? 'Both parties can answer it with the deal’s record.' : 'Download the full record below (PayPal panel) and attach it to your answer in PayPal.'}
          </p>
        </div>
      )}

      <MoneyJourney m={m} />

      {/* minmax(0, ...) on phones too: a long word in the evidence (is_valid_email(...)) must not widen the page.
          On a phone the two columns become one list (display: contents) ordered by what matters: what to
          do, then the verdict, and the PayPal details and the timeline last. */}
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="contents lg:block lg:space-y-6">
          {role !== 'viewer' && (
            <div className="order-1 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-pp-border bg-white px-4 py-2.5 text-sm">
              <span>
                You are the <b>{role}</b> ({role === 'client' ? m.client.name : m.freelancer.name})
              </span>
              {both && (
                <span className="flex items-center gap-1 rounded-full bg-pp-canvas p-1 text-xs" role="group" aria-label="View as">
                  {(['client', 'freelancer'] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setChosen(r)}
                      aria-pressed={role === r}
                      className={`rounded-full px-3 py-1 font-semibold ${role === r ? 'bg-pp-navy text-white' : 'text-pp-blue hover:bg-white'}`}
                    >
                      {r}
                    </button>
                  ))}
                </span>
              )}
            </div>
          )}

          {/* The half-done demo is about settling, so its offer comes first; elsewhere fixing the work does. */}
          {settleFirst && (
            <div className="order-2">
              <Settlement m={m} role={role as Party} milestoneKey={key} onChange={setM} />
            </div>
          )}

          <div className="order-3">
            <NextStep m={m} role={role} milestoneKey={key} paypalClientId={paypalClientId} onFunded={refresh} onChange={setM} waitForStage={waitForStage} />
          </div>

          {canSettle && !settleFirst && (
            <div className="order-6">
              <Settlement m={m} role={role as Party} milestoneKey={key} onChange={setM} />
            </div>
          )}

          {m.status === 'released' && role !== 'viewer' && m.payment.captureId && (
            <div className="order-4">
              <AfterPayment m={m} role={role} milestoneKey={key} onChange={setM} />
            </div>
          )}

          {m.board && (
            <div className="order-9">
              <BoardStatus m={m} />
            </div>
          )}

          {role === 'client' && !m.board && keys.share && !['released', 'cancelled'].includes(m.status) && (
            <div className="order-12">
              <ShareLink id={m.id} shareKey={keys.share} name={m.freelancer.name} />
            </div>
          )}

          <div className="order-10">
            <PaymentDetails m={m} milestoneKey={key} />
          </div>
          <div className="order-11">
            <Timeline m={m} />
          </div>
        </div>

        <div className="contents lg:block lg:space-y-6">
          <div className="order-5">
            <Verdict m={m} />
          </div>
          <div className="order-7">
            <AgentLog entries={review?.log ?? []} live={m.status === 'reviewing'} role={role} reviewed={!!review} />
          </div>
          {role !== 'viewer' && (
            <div className="order-8">
              <Submissions m={m} fileKey={key} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Person({ name, tone }: { name: string; tone: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3 font-medium text-pp-ink ring-1 ring-pp-border">
      <span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ${tone}`}>{initials(name)}</span>
      {name}
    </span>
  );
}

const DEMO_TITLE: Record<string, string> = { honest: 'Honest work gets paid', cheater: 'A cheater gets caught', partial: 'Half the work, half the pay', code: 'Code that doesn’t work', arena: 'Try to fool it' };

/** What to click next in a demo deal. */
function DemoGuide({ m, role }: { m: Milestone; role: Role }) {
  const s = m.demo!.scenario;
  const other = role === 'client' ? 'freelancer' : 'client';
  const arena = s === 'arena';
  // An open offer is the next thing to act on, whichever side made it.
  const offer = m.settlement && ['changes_requested', 'escalated'].includes(m.status) ? m.settlement : null;
  const offerTip = offer
    ? offer.by === role
      ? `You offered ${fmtMoney(offer.amount, m.currency)}. Switch to the ${other} to accept it.`
      : `The ${other} offered to settle for ${fmtMoney(offer.amount, m.currency)}. Accept it and PayPal captures only that; the rest of the hold goes back to the client.`
    : null;
  const tip = arena
    ? m.status === 'funded'
      ? 'Write your trick in the notes and hand in the draft. A live Claude review decides, and a second model has to agree before anything is paid.'
      : m.status === 'reviewing'
        ? 'Claude is reviewing your delivery right now: a live run, not a replay. Watch the audit log.'
        : ['verified', 'released'].includes(m.status)
          ? 'It got paid. That counts as a false payout on the scoreboard, and we would love to know how you did it.'
          : 'Held: the draft did not get paid and the money stays on hold. Read why in the verdict, or try another trick from the demo page.'
    : m.status === 'funded'
      ? role === 'freelancer'
        ? 'You are the freelancer. Hand in the prepared work below and watch the AI review it.'
        : 'Switch to the freelancer (left column) and hand in the work.'
      : m.status === 'reviewing'
        ? 'The AI is reviewing it now. This is a replay of a real Claude Opus run: the findings fill in as it works, and the audit log shows every step.'
        : offerTip
          ? offerTip
        : m.status === 'escalated'
          ? role === 'client'
            ? 'The second model refused to confirm, so the money waits for you. Read why in the verdict, then decide.'
            : 'The second model refused to confirm the release. Switch to the client to make the call.'
          : m.status === 'changes_requested' && s === 'code'
            ? 'The notes said all tests pass. The AI ran them in Anthropic’s sandbox, one failed, so it asked for a fix and kept the money on hold. Open the audit log to see the commands it ran.'
            : m.status === 'changes_requested'
            ? `The AI asked for changes and the money stays on hold. Offer a settlement (say $60), then switch to the ${other} to accept it.`
            : m.status === 'verified'
              ? 'Verified. Switch to the client to pay now or object.'
              : m.status === 'released' && m.complaint?.status === 'open'
                ? role === 'client'
                  ? 'Switch to the freelancer to refund or decline.'
                  : `The client asks for ${fmtMoney(m.complaint.amount, m.currency)} back. Refund it (PayPal returns it from the payment) or decline.`
              : m.status === 'released' && m.complaint?.status === 'refunded'
                ? 'Refunded: PayPal returned the money to the client from the payment, and the deal record shows every step.'
              : m.status === 'released'
                ? m.payment.capturedAmount
                  ? 'Settled: PayPal captured only the agreed amount, and the rest of the hold went back to the client.'
                  : `Done: PayPal captured the hold and paid the freelancer, and nobody clicked approve.${role === 'client' && !m.complaint ? ' If the work turns out wrong later, report a problem below and ask for money back.' : ''}`
                : 'Cancelled: the hold was voided, nothing was charged.';
  return (
    <div className="mt-6 flex flex-col gap-3 rounded-2xl bg-pp-navy px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-sky-200">Demo · {DEMO_TITLE[s] ?? s}</div>
        <div className="mt-1 text-[15px]">{tip}</div>
      </div>
      <a href="/demo" className="shrink-0 self-start rounded-full bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20 sm:self-auto">
        All scenarios
      </a>
    </div>
  );
}

/** A job on the open board: listed, taken, or done. */
function BoardStatus({ m }: { m: Milestone }) {
  const b = m.board!;
  const listed = m.status === 'funded' && !b.claimedAt;
  return (
    <section className={`${card} ${listed ? 'border-pp-blue ring-2 ring-pp-highlight' : ''}`}>
      <h2 className={h2}>Open job board</h2>
      <p suppressHydrationWarning className="mt-2 text-[15px] leading-relaxed text-pp-ink">
        {m.status === 'awaiting_funding'
          ? 'Listed as soon as PayPal holds the money: agents only see jobs that are already paid for.'
          : listed
            ? 'Listed now. Any AI agent can take it through MCP, or a person from the jobs page.'
            : b.claimedAt
              ? `Taken by ${b.claimedBy} ${ago(b.claimedAt)}.`
              : 'No longer listed.'}
      </p>
      {listed && (
        <a href="/jobs" className="mt-3 inline-block text-sm font-semibold text-pp-blue hover:underline">
          See it on the board →
        </a>
      )}
    </section>
  );
}

function ago(iso: string) {
  const min = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return min < 60 ? `${min} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} days ago`;
}

/** The project this stage belongs to: every stage, what it pays and where it stands. */
function ProjectStages({ m, stages }: { m: Milestone; stages: StageSummary[] }) {
  const total = stages.reduce((sum, x) => sum + Number(x.amount), 0);
  const paid = stages.reduce((sum, x) => sum + Number(x.paid ?? 0), 0);
  return (
    <section className={`${card} mt-6`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={h2}>
          Project · {m.project!.title} · stage {m.project!.stage} of {stages.length}
        </h2>
        <span className="text-sm text-pp-muted">
          {fmtMoney(paid, m.currency)} of {fmtMoney(total, m.currency)} paid
        </span>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        {stages.map((x) => (
          <li key={x.id}>
            <a
              href={`/m/${x.id}`}
              aria-current={x.id === m.id ? 'step' : undefined}
              className={`flex h-full flex-col gap-2 rounded-xl border p-3 text-sm hover:border-pp-blue ${x.id === m.id ? 'border-pp-blue bg-pp-highlight/50' : 'border-pp-border'}`}
            >
              <span className="text-xs font-semibold text-pp-muted">Stage {x.stage}</span>
              <span className="font-semibold leading-snug text-pp-ink">{x.title}</span>
              <span className="mt-auto flex items-center justify-between gap-2">
                <StatusBadge status={x.status} />
                <span className="tabular-nums text-pp-muted">{fmtMoney(x.amount, x.currency)}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
