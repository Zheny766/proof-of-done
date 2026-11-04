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
