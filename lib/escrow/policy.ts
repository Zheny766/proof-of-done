// Release rule, enforced in code: money is captured only if every criterion the AI checks has a "met"
// finding at or above the milestone's threshold. Whatever the model says, it can't get around this.
// Criteria marked for the client (matters of taste) are the client's call: they don't count here, and
// a deal that has any goes through the client's objection window before PayPal captures.

import type { Criterion, CriterionFinding, Milestone, Review } from './types.ts';

export interface PolicyResult {
  ok: boolean;
  reasons: string[];
}

/** Whether some criteria are the client's to judge (taste), not the AI's. */
export const hasClientCriteria = (criteria: Criterion[]) => criteria.some((c) => c.judge === 'client');

/** Latest finding per criterion, in criteria order (the reviewer may revise a finding). */
export function latestFindings(criteria: Criterion[], findings: CriterionFinding[]): (CriterionFinding | undefined)[] {
  return criteria.map((c) => findings.findLast((f) => f.criterionId === c.id));
}

export function checkReleasePolicy(criteria: Criterion[], findings: CriterionFinding[], threshold: number): PolicyResult {
  const latest = latestFindings(criteria, findings);
  const reasons: string[] = [];
  if (criteria.every((c) => c.judge === 'client')) reasons.push('Every criterion is the client’s call, so the client decides');
  criteria.forEach((c, i) => {
    if (c.judge === 'client') return;
    const f = latest[i];
    if (!f) reasons.push(`No finding recorded for "${c.text}"`);
    else if (f.status !== 'met') reasons.push(`"${c.text}" is ${f.status.replace('_', ' ')}`);
    else if (f.confidence < threshold)
      reasons.push(`"${c.text}" confidence ${Math.round(f.confidence * 100)}% is below the ${Math.round(threshold * 100)}% threshold`);
  });
  return { ok: reasons.length === 0, reasons };
}

/** The latest review, unless the terms changed after it: then it judged criteria that no longer apply. */
export const currentReview = (m: Milestone): Review | undefined => {
  const r = m.reviews.at(-1);
  return r && (!m.termsChangedAt || r.startedAt > m.termsChangedAt) ? r : undefined;
};

/** The deadline passed with nothing that passed review (an overdue event since the terms last changed). */
export const isOverdue = (m: Milestone) =>
  ['funded', 'changes_requested'].includes(m.status) && m.timeline.some((e) => e.type === 'overdue' && (!m.termsChangedAt || e.at > m.termsChangedAt));

// Fair to both sides once work is delivered. Before any delivery the client can always cancel and void
// the hold. After one, the client can't simply walk away with the work: a delivery the AI verified is
// objected to with a reason or settled, and a freelancer asked for a fix gets time to make it. A
// delivery an independent check flagged as a trick, a missed deadline, or three failed tries can be
// cancelled at once.
export const FIX_WINDOW_MS = 3 * 86_400_000;
export const MAX_OBJECTIONS = 2;
export const MIN_REASON = 10;

/** How many times the client objected to a delivery the AI had verified. */
export const objections = (m: Milestone) => m.timeline.filter((e) => e.type === 'changes_requested' && e.actor === 'client' && /objected/.test(e.text)).length;

/** The latest review's independent checks found a trick, or refused to confirm. */
export function flagged(m: Milestone): boolean {
  const r = m.reviews.at(-1);
  return [r?.audit, ...(r?.panel ?? [])].some((a) => !!a && !a.unavailable && (a.redFlags.length > 0 || !a.agreed));
}

/** Why the client can't cancel and void the hold now, or null when they can. */
export function cancelBlock(m: Milestone, now = Date.now()): string | null {
  if (!['funded', 'changes_requested', 'escalated', 'verified'].includes(m.status) || m.submissions.length === 0) return null;
  if (flagged(m)) return null;
  if (m.status === 'verified') return 'The AI verified this delivery, so it can’t just be cancelled: object and say what’s wrong. The freelancer then fixes it, or you settle for part.';
  if (isOverdue(m)) return null;
  if (m.reviews.filter((r) => r.decision === 'request_changes').length >= 3) return null;
  const lastAsk = m.timeline.findLast((e) => ['changes_requested', 'escalated', 'submitted', 'review_failed'].includes(e.type));
  const wanted = Math.max(m.dueAt ? Date.parse(m.dueAt) : 0, (lastAsk ? Date.parse(lastAsk.at) : now) + FIX_WINDOW_MS);
  // A fix can only be paid from a hold that still exists: the window never runs past PayPal's.
  const holdEnds = m.payment.expiresAt ? Date.parse(m.payment.expiresAt) : Infinity;
  const fixBy = Math.min(wanted, holdEnds);
  if (now >= fixBy) return null;
  const when = new Date(fixBy).toISOString().slice(0, 16).replace('T', ' ');
  return fixBy === holdEnds
    ? `${m.freelancer.name} delivered work and has until ${when} UTC, when PayPal's hold ends, to fix what’s asked. Until then, ask for changes, settle for part, or pay.`
    : `${m.freelancer.name} delivered work and has until ${when} UTC to fix what’s asked. Until then, ask for changes, settle for part, or pay.`;
}

/** Why the client can't object to (or ask changes on) the delivery now, or null when they can. */
export function objectionBlock(m: Milestone): string | null {
  if (m.status === 'verified' && objections(m) >= MAX_OBJECTIONS) {
    return `You objected ${MAX_OBJECTIONS} times already, so this time the work stands: pay now, or the payment goes out when the window closes.`;
  }
  return null;
}

/**
 * Real PayPal money moves only on a live AI review: never on the keyword stand-in (used when no AI key is
 * set or the day's live reviews are used up) or a replayed recording, whatever their checks said.
 */
export const liveReviewRequired = (m: Milestone, engine: Review['engine']) => m.payment.mode === 'sandbox' && engine !== 'claude';
