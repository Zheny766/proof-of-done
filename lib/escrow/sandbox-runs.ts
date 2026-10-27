// Deals that ran end to end on the real PayPal sandbox, kept in the repo as evidence: the PayPal ids
// at every step (order, authorization, capture, payout), each REST call with PayPal's debug id, what
// the reviewer and the second opinion decided, and the timeline. No keys, no email addresses, no work.
// scripts/export-sandbox-run.ts writes them; /sandbox shows them.

import fs from 'node:fs';
import path from 'node:path';
import { redactEmails, viewerEventText } from './access.ts';
import { latestFindings } from './policy.ts';
import type { Milestone } from './types.ts';

export type SandboxRun = ReturnType<typeof publicRun>;

export function publicRun(m: Milestone) {
  if (m.payment.mode !== 'sandbox' || !m.payment.authorizationId) throw new Error(`${m.id} did not run on the PayPal sandbox.`);
  const p = m.payment;
  const review = m.reviews.findLast((r) => r.decision) ?? m.reviews.at(-1);
  const findings = review ? latestFindings(m.criteria, review.findings) : [];
  return {
    id: m.id,
    title: m.title,
    amount: m.amount,
    currency: m.currency,
    status: m.status,
    createdAt: m.createdAt,
    takenBy: m.board?.claimedBy ? redactEmails(m.board.claimedBy) : null,
    criteria: m.criteria.map((c, i) => ({ text: c.text, status: findings[i]?.status ?? null, confidence: findings[i]?.confidence ?? null })),
    review: review
      ? {
          reviewer: review.engine === 'claude' ? review.model : review.engine,
          decision: review.decision ?? null,
          secondOpinion: review.audit ? { by: review.audit.engine === 'claude' ? review.audit.model : review.audit.engine, agreed: review.audit.agreed } : null,
        }
      : null,
    paypal: {
      orderId: p.orderId,
      authorizationId: p.authorizationId,
      authorizationStatus: p.authorizationStatus ?? null,
      authorizedAt: p.authorizedAt ?? null,
      previousAuthorizationId: p.previousAuthorizationId ?? null,
      reauthorizedAt: p.reauthorizedAt ?? null,
      captureId: p.captureId ?? null,
      capturedAt: p.capturedAt ?? null,
      capturedAmount: p.capturedAmount ?? (p.captureId ? m.amount : null),
      payoutBatchId: p.payoutBatchId ?? null,
      payoutStatus: p.payoutStatus ?? null,
      voidedAt: p.voidedAt ?? null,
    },
    calls: (m.paypalCalls ?? []).map((c) => ({ at: c.at, method: c.method, path: c.path, status: c.status, ms: c.ms, debugId: c.debugId ?? null })),
    // The same steps a visitor without a link sees: no notes, no reviewer summaries, no emails.
    timeline: m.timeline.map((e) => ({ at: e.at, actor: e.actor, text: viewerEventText(e) })),
  };
}

// A fixed folder, so the build traces just it rather than the whole project.
const RUNS_DIR = path.join(process.cwd(), 'demo', 'sandbox-runs');

export function sandboxRuns(): SandboxRun[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')) as SandboxRun)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
