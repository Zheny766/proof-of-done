// Release rule, enforced in code: money is captured only if every criterion has a "met" finding at
// or above the milestone's threshold. Whatever the model says, it can't get around this.

import type { Criterion, CriterionFinding } from './types';

export interface PolicyResult {
  ok: boolean;
  reasons: string[];
}

/** Latest finding per criterion, in criteria order (the reviewer may revise a finding). */
export function latestFindings(criteria: Criterion[], findings: CriterionFinding[]): (CriterionFinding | undefined)[] {
  return criteria.map((c) => findings.findLast((f) => f.criterionId === c.id));
}

export function checkReleasePolicy(criteria: Criterion[], findings: CriterionFinding[], threshold: number): PolicyResult {
  const latest = latestFindings(criteria, findings);
  const reasons: string[] = [];
  criteria.forEach((c, i) => {
    const f = latest[i];
    if (!f) reasons.push(`No finding recorded for "${c.text}"`);
    else if (f.status !== 'met') reasons.push(`"${c.text}" is ${f.status.replace('_', ' ')}`);
    else if (f.confidence < threshold)
      reasons.push(`"${c.text}" confidence ${Math.round(f.confidence * 100)}% is below the ${Math.round(threshold * 100)}% threshold`);
  });
  return { ok: reasons.length === 0, reasons };
}
