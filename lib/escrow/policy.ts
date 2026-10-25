// The release policy is code, not prompt: the agent can ask to release money, but the capture only
// happens if every acceptance criterion has a "met" finding at or above the milestone's confidence
// threshold. This keeps a confused or manipulated model from paying out on its own say-so.

import type { Criterion, CriterionFinding } from './types';

export interface PolicyResult {
  ok: boolean;
  reasons: string[];
}

export function checkReleasePolicy(
  criteria: Criterion[],
  findings: CriterionFinding[],
  threshold: number,
): PolicyResult {
  const reasons: string[] = [];
  for (const c of criteria) {
    // The latest finding for a criterion wins (the agent may revise itself).
    const f = [...findings].reverse().find((x) => x.criterionId === c.id);
    if (!f) reasons.push(`No finding recorded for "${c.text}"`);
    else if (f.status !== 'met') reasons.push(`"${c.text}" is ${f.status.replace('_', ' ')}`);
    else if (f.confidence < threshold)
      reasons.push(`"${c.text}" confidence ${Math.round(f.confidence * 100)}% is below the ${Math.round(threshold * 100)}% threshold`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Latest finding per criterion, in criteria order. */
export function latestFindings(criteria: Criterion[], findings: CriterionFinding[]): (CriterionFinding | undefined)[] {
  return criteria.map((c) => [...findings].reverse().find((f) => f.criterionId === c.id));
}
