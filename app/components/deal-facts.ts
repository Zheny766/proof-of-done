// A deal described in plain text for an AI agent: the dashboard assistant's explain_deal tool and the
// WebMCP tools use it. Reads the public view of the milestone, so it works without either party's key.

import type { Milestone } from '@/lib/escrow/types';
import { latestFindings } from '@/lib/escrow/policy';

export function describeDeal(m: Milestone): string {
  const review = m.reviews.at(-1);
  const findings = review ? latestFindings(m.criteria, review.findings) : [];
  const lines = [
    `${m.title} (${m.id}): ${m.amount} ${m.currency}, ${m.client.name} pays ${m.freelancer.name}.`,
    `Status: ${m.status}${m.releaseAt ? `, pays out at ${m.releaseAt} unless the client objects` : ''}.`,
    `PayPal (${m.payment.mode}): authorization ${m.payment.authorizationStatus ?? 'none'}${m.payment.captureId ? `, captured ${m.payment.capturedAmount ?? m.amount}` : ''}${m.payment.payoutStatus ? `, payout ${m.payment.payoutStatus}` : ''}.`,
    `Criteria (release needs every one met at ${Math.round(m.releaseThreshold * 100)}% or more):`,
    ...m.criteria.map((c, i) => {
      const f = findings[i];
      return `- ${c.text}: ${f ? `${f.status} at ${Math.round(f.confidence * 100)}%` : 'not reviewed'}`;
    }),
  ];
  if (review) {
    lines.push(`Reviewer: ${review.engine}${review.model ? ` (${review.model})` : ''}, decision ${review.decision ?? 'pending'}.`);
    if (review.audit) {
      lines.push(
        review.audit.agreed
          ? `Second opinion (${review.audit.model ?? 'simulated'}): confirmed every criterion.`
          : `Second opinion (${review.audit.model ?? 'simulated'}): refused the release${review.audit.redFlags.length ? ` (${review.audit.redFlags.length} red flag(s): someone tried to steer the reviewer)` : ''}${review.audit.disputed.length ? `, disputed ${review.audit.disputed.map((d) => d.criterionId).join(', ')}` : ''}.`,
      );
    }
  }
  lines.push('Latest events:', ...m.timeline.slice(-6).map((e) => `- ${e.at.slice(0, 16)} ${e.actor}: ${e.text}`));
  return lines.join('\n');
}

export async function dealFacts(id: string): Promise<string> {
  if (!/^ms_[\w-]{4,40}$/.test(id)) throw new Error(`"${id}" is not a milestone id (they look like ms_1a2b3c4d5e6f).`);
  const res = await fetch(`/api/escrow/milestones/${id}`);
  if (!res.ok) throw new Error(res.status === 404 ? `No milestone ${id}.` : `Could not load ${id} (HTTP ${res.status}).`);
  const { milestone } = (await res.json()) as { milestone: Milestone };
  return describeDeal(milestone);
}
