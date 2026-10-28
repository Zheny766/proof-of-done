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
    `PayPal (${m.payment.mode}): authorization ${m.payment.authorizationStatus ?? 'none'}${m.payment.reauthorizedAt ? ' (reauthorized after the 3-day honor period)' : ''}${m.payment.captureId ? `, captured ${m.payment.capturedAmount ?? m.amount}` : ''}${m.payment.payoutStatus ? `, payout ${m.payment.payoutStatus}` : ''}.`,
    ...(m.project ? [`Stage ${m.project.stage} of ${m.project.stageIds.length} of the project "${m.project.title}"; each stage is funded after the one before it is paid.`] : []),
    ...(m.board ? [m.board.claimedAt ? `Taken from the open job board by ${m.board.claimedBy}.` : 'On the open job board, not taken yet.'] : []),
    ...(m.postedBy ? [`Posted for the client by the AI agent ${m.postedBy}.`] : []),
    ...(m.complaint ? [`After the payment the client reported a problem and asked for ${m.complaint.amount} ${m.currency} back; ${m.complaint.status === 'open' ? 'the freelancer has not answered yet' : m.complaint.status}.`] : []),
    ...(m.payment.refunds?.length ? [`PayPal refunds to the client: ${m.payment.refunds.map((r) => `${r.amount} ${m.currency} (${r.status.toLowerCase()})`).join(', ')}.`] : []),
    ...(m.disputes?.length ? [`PayPal ${m.disputes.length === 1 ? 'dispute' : 'disputes'}: ${m.disputes.map((d) => `${d.id} (${d.reason}, ${d.status})`).join('; ')}.`] : []),
    ...(m.timeline.some((e) => e.type === 'probation') ? ['The AI verified the work, but the payee is on probation (a poor record), so the client approves the payment.'] : []),
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
          : `Second opinion (${review.audit.model ?? 'simulated'}): refused the release${review.audit.redFlags.length ? ` (${review.audit.redFlags.length} red ${review.audit.redFlags.length === 1 ? 'flag' : 'flags'}: someone tried to steer the reviewer)` : ''}${review.audit.disputed.length ? `, disputed ${review.audit.disputed.map((d) => d.criterionId).join(', ')}` : ''}.`,
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
