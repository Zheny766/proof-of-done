// The whole record of a deal for either party, as one JSON document: what to hand PayPal (or anyone)
// in a dispute. What was agreed, what was delivered (with each file's SHA-256), what the reviewer found
// and why, what the second opinion said, every step and who took it, and the PayPal ids.

import { checkSeal } from './chain.ts';
import { currentReview, latestFindings } from './policy.ts';
import type { Milestone, Role } from './types.ts';

export function dealRecord(m: Milestone, role: Exclude<Role, 'viewer'>, origin: string) {
  // A review made before the terms changed was against the old criteria.
  const review = currentReview(m);
  return {
    kind: 'Proof of Done deal record',
    generatedAt: new Date().toISOString(),
    requestedBy: role,
    deal: { id: m.id, title: m.title, brief: m.description, amount: `${m.amount} ${m.currency}`, status: m.status, createdAt: m.createdAt, releaseThreshold: m.releaseThreshold, objectionHours: m.objectionHours ?? 0 },
    client: m.client,
    freelancer: m.freelancer,
    criteria: m.criteria.map((c, i) => ({ ...c, finding: review ? (latestFindings(m.criteria, review.findings)[i] ?? null) : null })),
    deliveries: m.submissions.map((s) => ({ at: s.at, notes: s.notes, links: s.links, files: s.attachments.map((a) => ({ name: a.name, type: a.mime, bytes: a.size, sha256: a.sha256 ?? null })) })),
    reviews: m.reviews.map((r) => ({
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? null,
      reviewer: r.engine === 'claude' ? r.model : r.engine,
      decision: r.decision ?? null,
      summary: r.summary ?? null,
      feedback: r.feedback ?? null,
      secondOpinion: r.audit ? { by: r.audit.engine === 'claude' ? r.audit.model : 'simulated', agreed: r.audit.agreed, disputed: r.audit.disputed, redFlags: r.audit.redFlags } : null,
      steps: r.log,
    })),
    settlement: m.settlement ?? null,
    termsChangedAt: m.termsChangedAt ?? null,
    disputes: m.disputes ?? [],
    paypal: { ...m.payment, calls: m.paypalCalls ?? [] },
    timeline: m.timeline,
    // Check it offline: node scripts/verify-record.mjs <this file>
    seal: { ...checkSeal(m), rule: 'hash_0 = sha256(dealId + "\\n" + at + "\\n" + actor + "\\n" + type + "\\n" + text); hash_n = sha256(hash_{n-1} + "\\n" + ...the same fields)', anchoredAtPayPal: m.payment.anchoredRecord ?? null },
    certificate: m.status === 'released' ? `${origin}/m/${m.id}/proof` : null,
  };
}
