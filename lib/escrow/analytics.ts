import 'server-only';
// Milestones flattened into six tables (milestones, reviews, findings, events, PayPal calls, board jobs) for AG Studio.

import { redactEmails } from './access.ts';
import { paymentMode } from './payments.ts';
import { latestFindings } from './policy.ts';
import { listMilestones } from './store.ts';
import { trustFor, type TrustTier } from './trust.ts';
import type { CriterionStatus, ReviewDecision } from './types.ts';

export type MilestoneRow = {
  id: string;
  title: string;
  category: string;
  status: string;
  stage: string;
  client: string;
  freelancer: string;
  currency: string;
  amount: number;
  /** The amount, except for cancelled milestones: their hold was voided, so the money is back with the client. */
  escrowed: number;
  onHold: number;
  released: number;
  voided: number;
  /** Paid, then returned to the client after a complaint. */
  refunded: number;
  createdAt: string;
  createdDate: string;
  fundedAt: string | null;
  releasedAt: string | null;
  hoursToPaid: number | null;
  criteriaCount: number;
  criteriaMet: number;
  submissions: number;
  reviews: number;
  autoReleased: boolean;
  isReleased: number;
  isAutoReleased: number;
  lowestConfidence: number | null;
  paymentMode: string;
  isDemo: boolean;
  /** The project this milestone is a stage of ('' for a single job), and which stage. */
  project: string;
  projectStage: number | null;
  /** The standing of whoever gets paid (by payout email), as of now. */
  freelancerStanding: string;
};

export type ReviewRow = {
  id: string;
  milestoneId: string;
  startedAt: string;
  startedDate: string;
  engine: string;
  decision: string;
  durationSec: number | null;
  findings: number;
  metCount: number;
  notMetCount: number;
  unclearCount: number;
  avgConfidence: number | null;
  inputTokens: number;
  outputTokens: number;
  /** confirmed / refused / not asked (the release was never attempted). */
  secondOpinion: string;
  secondOpinionAsked: number;
  isVeto: number;
  redFlags: number;
};

export type PayPalCallRow = {
  id: string;
  milestoneId: string;
  at: string;
  date: string;
  method: string;
  /** The path with ids replaced, so calls group by endpoint. */
  endpoint: string;
  status: number;
  ok: boolean;
  isError: number;
  ms: number;
  /** PayPal's own id for the request (`PayPal-Debug-Id`), what PayPal support asks for. */
  debugId: string;
};

export type FindingRow = {
  id: string;
  milestoneId: string;
  reviewId: string;
  criterion: string;
  status: string;
  confidence: number;
  aboveThreshold: boolean;
  evidence: string;
};

export type EventRow = {
  id: string;
  milestoneId: string;
  at: string;
  date: string;
  actor: string;
  type: string;
  text: string;
};

/** A job posted on the open board: who took it and how it ended. */
export type BoardJobRow = {
  id: string;
  milestoneId: string;
  title: string;
  takenBy: string;
  postedAt: string;
  postedDate: string;
  outcome: string;
  amount: number;
  earned: number;
  isTaken: number;
  isPaid: number;
  isDecided: number;
  hoursToPaid: number | null;
  takerStanding: string;
};

export type EscrowDashboardData = {
  asOf: string;
  paymentMode: 'sandbox' | 'simulated';
  milestones: MilestoneRow[];
  reviews: ReviewRow[];
  findings: FindingRow[];
  events: EventRow[];
  paypalCalls: PayPalCallRow[];
  boardJobs: BoardJobRow[];
};

const STAGE: Record<string, string> = {
  awaiting_funding: '1 · Awaiting funding',
  funded: '2 · Funded (on hold)',
  reviewing: '3 · In review',
  changes_requested: '3 · Changes requested',
  escalated: '3 · Escalated to client',
  verified: '3 · Verified, releasing',
  released: '4 · Paid',
  cancelled: '0 · Cancelled',
};

const categoryOf = (description: string, title: string) => {
  const m = description.match(/^\[Demo data\] (\w+) job/);
  if (m) return m[1];
  const t = title.toLowerCase();
  if (/logo|design|deck|cover|illustrat/.test(t)) return 'Design';
  if (/page|site|web|shopify|bug|app/.test(t)) return 'Web';
  if (/post|blog|translat|copy|write/.test(t)) return 'Writing';
  if (/video|edit|reel/.test(t)) return 'Video';
  if (/script|zap|automat|sync/.test(t)) return 'Automation';
  if (/data|csv|crm|clean/.test(t)) return 'Data';
  return 'Other';
};

// Rows carry the words people read in the dashboard's legends and tables, not the code's values.
// Short, so a chart legend fits all three on one line.
const DECISION: Record<ReviewDecision, string> = { release: 'Pay', request_changes: 'Changes', escalate: 'To the client' };
const VERDICT: Record<CriterionStatus, string> = { met: 'Met', not_met: 'Not met', unclear: 'Unclear' };
const STANDING: Record<TrustTier, string> = { new: 'New', regular: 'Regular', trusted: 'Trusted', probation: 'On probation' };

export function getEscrowDashboardData(): EscrowDashboardData {
  // Demo deals stay out, except board jobs a visitor's agent took: that is real agent activity, on a simulated hold.
  const milestones = listMilestones().filter((m) => !m.demo || (m.demo.scenario === 'board' && m.board?.claimedAt));
  const mRows: MilestoneRow[] = [];
  const rRows: ReviewRow[] = [];
  const fRows: FindingRow[] = [];
  const eRows: EventRow[] = [];
  const pRows: PayPalCallRow[] = [];
  const bRows: BoardJobRow[] = [];

  // Standings are counted from everything in the store, once per payout address.
  const all = listMilestones();
  const standings = new Map<string, string>();
  const standing = (email: string) => {
    if (!standings.has(email)) standings.set(email, email ? STANDING[trustFor(email, undefined, all).tier] : 'None');
    return standings.get(email)!;
  };

  for (const m of milestones) {
    const amount = Number(m.amount);
    const captured = Number(m.payment.capturedAmount ?? m.amount);
    const lastReview = m.reviews.at(-1);
    const latest = lastReview ? latestFindings(m.criteria, lastReview.findings).filter(Boolean) : [];
    const releasedEvent = m.timeline.find((e) => e.type === 'captured');
    const autoReleased = m.status === 'released' && m.timeline.some((e) => e.type === 'verified');
    const fundedAt = m.payment.authorizedAt ?? null;
    const releasedAt = m.payment.capturedAt ?? releasedEvent?.at ?? null;
    mRows.push({
      id: m.id,
      title: m.title,
      category: categoryOf(m.description, m.title),
      status: m.status,
      stage: STAGE[m.status] ?? m.status,
      client: m.client.name,
      freelancer: m.freelancer.name,
      currency: m.currency,
      amount,
      // Money still in play or paid out: a cancelled hold and the part of a settlement that went back to the client drop out.
      escrowed: m.status === 'cancelled' ? 0 : m.status === 'released' ? captured : amount,
      onHold: ['funded', 'reviewing', 'changes_requested', 'escalated', 'verified'].includes(m.status) ? amount : 0,
      released: m.status === 'released' ? captured : 0,
      // A settlement captures part of the hold; PayPal releases the rest back to the client.
      voided: m.status === 'cancelled' && m.payment.authorizationId ? amount : amount - (m.status === 'released' ? captured : amount),
      refunded: (m.payment.refunds ?? []).filter((r) => r.status !== 'FAILED' && r.status !== 'CANCELLED').reduce((sum, r) => sum + Number(r.amount), 0),
      createdAt: m.createdAt,
      createdDate: m.createdAt.slice(0, 10),
      fundedAt,
      releasedAt,
      hoursToPaid: fundedAt && releasedAt ? Math.max(0, Math.round((+new Date(releasedAt) - +new Date(fundedAt)) / 3_600_000)) : null,
      criteriaCount: m.criteria.length,
      criteriaMet: latest.filter((f) => f!.status === 'met').length,
      submissions: m.submissions.length,
      reviews: m.reviews.length,
      autoReleased,
      isReleased: m.status === 'released' ? 1 : 0,
      isAutoReleased: autoReleased ? 1 : 0,
      lowestConfidence: latest.length ? Math.min(...latest.map((f) => f!.confidence)) : null,
      paymentMode: m.payment.mode,
      isDemo: m.description.startsWith('[Demo data]'),
      project: m.project?.title ?? '',
      projectStage: m.project?.stage ?? null,
      freelancerStanding: standing(m.freelancer.email),
    });

    if (m.board) {
      const aiPaid = m.status === 'released' && autoReleased;
      const decided = ['released', 'changes_requested', 'escalated', 'cancelled'].includes(m.status);
      const takenAt = m.board.claimedAt ?? null;
      bRows.push({
        id: `${m.id}-board`,
        milestoneId: m.id,
        title: m.title,
        takenBy: m.board.claimedBy ?? 'not taken yet',
        postedAt: m.board.postedAt,
        postedDate: m.board.postedAt.slice(0, 10),
        outcome: !takenAt ? 'Open on the board' : aiPaid ? 'Paid after review' : m.status === 'released' ? 'Paid by the client' : decided ? 'Held' : 'Working on it',
        amount,
        earned: m.status === 'released' ? captured : 0,
        isTaken: takenAt ? 1 : 0,
        isPaid: m.status === 'released' ? 1 : 0,
        isDecided: decided ? 1 : 0,
        hoursToPaid: takenAt && releasedAt ? Math.max(0, Math.round((+new Date(releasedAt) - +new Date(takenAt)) / 3_600_000)) : null,
        takerStanding: takenAt ? standing(m.freelancer.email) : 'Not taken',
      });
    }

    for (const r of m.reviews) {
      const counts = { met: 0, not_met: 0, unclear: 0 };
      r.findings.forEach((f) => counts[f.status]++);
      rRows.push({
        id: r.id,
        milestoneId: m.id,
        startedAt: r.startedAt,
        startedDate: r.startedAt.slice(0, 10),
        engine: r.engine === 'claude' ? `Claude (${r.model ?? 'claude'})` : 'Simulated',
        decision: r.decision ? DECISION[r.decision] : 'In progress',
        durationSec: r.finishedAt ? Math.round((+new Date(r.finishedAt) - +new Date(r.startedAt)) / 1000) : null,
        findings: r.findings.length,
        metCount: counts.met,
        notMetCount: counts.not_met,
        unclearCount: counts.unclear,
        avgConfidence: r.findings.length ? r.findings.reduce((s, f) => s + f.confidence, 0) / r.findings.length : null,
        inputTokens: r.usage?.inputTokens ?? 0,
        outputTokens: r.usage?.outputTokens ?? 0,
        secondOpinion: !r.audit ? 'Not asked' : r.audit.agreed ? 'Confirmed' : r.audit.redFlags.length ? 'Refused: red flag' : 'Refused: evidence',
        secondOpinionAsked: r.audit ? 1 : 0,
        isVeto: r.audit && !r.audit.agreed ? 1 : 0,
        redFlags: r.audit?.redFlags.length ?? 0,
      });
      r.findings.forEach((f, i) =>
        fRows.push({
          id: `${r.id}-${i}`,
          milestoneId: m.id,
          reviewId: r.id,
          criterion: m.criteria.find((c) => c.id === f.criterionId)?.text ?? f.criterionId,
          status: VERDICT[f.status],
          confidence: f.confidence,
          aboveThreshold: f.status === 'met' && f.confidence >= m.releaseThreshold,
          evidence: f.evidence,
        }),
      );
    }

    (m.paypalCalls ?? []).forEach((c, i) =>
      pRows.push({
        id: `${m.id}-pp${i}`,
        milestoneId: m.id,
        at: c.at,
        date: c.at.slice(0, 10),
        method: c.method,
        endpoint: c.path.replace(/\/[A-Z0-9-]{10,}(?=\/|$)/g, '/{id}'),
        status: c.status,
        ok: c.status < 400,
        isError: c.status < 400 ? 0 : 1,
        ms: c.ms,
        debugId: c.debugId ?? '',
      }),
    );

    m.timeline.forEach((e, i) =>
      // The dashboard has no login, so no addresses in it.
      eRows.push({ id: `${m.id}-${i}`, milestoneId: m.id, at: e.at, date: e.at.slice(0, 10), actor: e.actor, type: e.type, text: redactEmails(e.text) }),
    );
  }

  return { asOf: new Date().toISOString(), paymentMode: paymentMode(), milestones: mRows, reviews: rRows, findings: fRows, events: eRows, paypalCalls: pRows, boardJobs: bRows };
}
