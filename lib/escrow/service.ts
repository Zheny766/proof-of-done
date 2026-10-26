import 'server-only';
// Every milestone state change goes through here, so status, payment and timeline stay in sync.

import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { roleFor, newAccess } from './access';
import { cancelFunding, completeFunding, paymentMode, refreshPayoutStatus, releaseFunds, startFunding } from './payments';
import { claudeErrorMessage, isClaudeConfigured } from '@/lib/ai';
import { REVIEW_MODEL, runClaudeReview, runSimulatedReview, type ReviewHooks } from './reviewer';
import { getMilestone, insertMilestone, newId, nowIso, pushEvent, updateMilestone, UPLOAD_DIR } from './store';
import type { Attachment, Milestone, Review, Role } from './types';

export class EscrowError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const money = (n: number, ccy: string) => `${n.toFixed(2)} ${ccy}`;

function requireRole(m: Milestone, key: string | null, role: Exclude<Role, 'viewer'>) {
  if (roleFor(m, key) !== role) {
    throw new EscrowError(role === 'client' ? 'Only the client can do this - open the client link.' : 'Only the freelancer can do this - open the freelancer link.', 403);
  }
}

export const CreateMilestoneInput = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(4000).default(''),
  criteria: z.array(z.string().trim().min(3).max(300)).min(1).max(12),
  amount: z.coerce.number().positive().max(10_000),
  // USD only for now: the dashboard and the home page totals add amounts up as dollars.
  currency: z.literal('USD').default('USD'),
  clientName: z.string().trim().min(1).max(80),
  clientEmail: z.email(),
  freelancerName: z.string().trim().min(1).max(80),
  freelancerEmail: z.email(),
  releaseThreshold: z.coerce.number().min(0.5).max(0.99).default(0.8),
});

export function createMilestone(raw: unknown): Milestone {
  const input = CreateMilestoneInput.parse(raw);
  const m: Milestone = {
    id: newId('ms'),
    title: input.title,
    description: input.description,
    criteria: input.criteria.map((text, i) => ({ id: `c${i + 1}`, text })),
    amount: input.amount.toFixed(2),
    currency: input.currency,
    client: { name: input.clientName, email: input.clientEmail },
    freelancer: { name: input.freelancerName, email: input.freelancerEmail },
    releaseThreshold: input.releaseThreshold,
    status: 'awaiting_funding',
    payment: { mode: paymentMode() },
    submissions: [],
    reviews: [],
    timeline: [],
    access: newAccess(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  pushEvent(m, 'client', 'created', `${m.client.name} created the milestone for ${money(input.amount, m.currency)}`);
  return insertMilestone(m);
}

export async function beginFunding(id: string, key: string | null): Promise<{ orderId: string }> {
  const m = mustGet(id);
  requireRole(m, key, 'client');
  if (m.status !== 'awaiting_funding') throw new EscrowError('This milestone is already funded.');
  const { orderId } = await startFunding(m);
  updateMilestone(id, (x) => {
    x.payment.orderId = orderId;
    x.payment.mode = paymentMode();
  });
  return { orderId };
}

export async function confirmFunding(id: string, orderId: string, key: string | null): Promise<Milestone> {
  const m = mustGet(id);
  requireRole(m, key, 'client');
  if (m.status !== 'awaiting_funding') return m;
  // Only the order we created for this milestone can fund it.
  if (!m.payment.orderId || m.payment.orderId !== orderId) throw new EscrowError('Order does not belong to this milestone.');
  const payment = await completeFunding(orderId);
  return updateMilestone(id, (x) => {
    x.payment = { ...x.payment, ...payment };
    x.status = 'funded';
    pushEvent(
      x,
      'paypal',
      'authorized',
      `PayPal authorized ${money(Number(x.amount), x.currency)}: the money is on hold, nothing has been charged yet`,
    );
  });
}

export interface IncomingFile {
  name: string;
  type: string;
  bytes: Buffer;
}

export function submitWork(
  id: string,
  input: { notes: string; links: string[]; files: IncomingFile[] },
  key: string | null,
): { milestone: Milestone; reviewId: string } {
  const m = mustGet(id);
  requireRole(m, key, 'freelancer');
  if (!['funded', 'changes_requested'].includes(m.status)) throw new EscrowError(`Cannot submit work while the milestone is ${m.status}.`);
  if (!input.notes.trim() && input.links.length === 0 && input.files.length === 0) throw new EscrowError('Add notes, a link or a file.');

  const submissionId = newId('sub');
  const dir = path.join(UPLOAD_DIR, id, submissionId);
  fs.mkdirSync(dir, { recursive: true });
  const attachments: Attachment[] = input.files.slice(0, 8).map((f, i) => {
    const safe = f.name.replace(/[^\w.\-]+/g, '_').slice(-80) || `file${i}`;
    const rel = path.join(id, submissionId, `${i}_${safe}`);
    fs.writeFileSync(path.join(UPLOAD_DIR, rel), f.bytes);
    return { id: newId('att'), name: f.name, mime: f.type || 'application/octet-stream', size: f.bytes.length, file: rel };
  });

  const reviewId = newId('rev');
  const milestone = updateMilestone(id, (x) => {
    x.submissions.push({ id: submissionId, at: nowIso(), notes: input.notes.trim(), links: input.links, attachments });
    x.reviews.push({
      id: reviewId,
      submissionId,
      startedAt: nowIso(),
      engine: isClaudeConfigured() ? 'claude' : 'simulated',
      model: isClaudeConfigured() ? REVIEW_MODEL : undefined,
      findings: [],
      log: [],
    });
    x.status = 'reviewing';
    pushEvent(x, 'freelancer', 'submitted', `${x.freelancer.name} submitted the work (${attachments.length} file(s), ${input.links.length} link(s))`);
    pushEvent(x, 'agent', 'review_started', 'The AI reviewer started checking the work against the acceptance criteria');
  });
  return { milestone, reviewId };
}

// Runs in the background (after()) once the submit request has returned.
export async function runReview(id: string, reviewId: string): Promise<void> {
  const m = mustGet(id);
  const review = m.reviews.find((r) => r.id === reviewId);
  const submission = review && m.submissions.find((s) => s.id === review.submissionId);
  if (!review || !submission) return;

  const patchReview = (fn: (r: Review, x: Milestone) => void) =>
    updateMilestone(id, (x) => {
      const r = x.reviews.find((rr) => rr.id === reviewId);
      if (r) fn(r, x);
    });

  const hooks: ReviewHooks = {
    log: (entry) => patchReview((r) => r.log.push({ at: nowIso(), ...entry })),
    finding: (f) =>
      patchReview((r) => {
        r.findings = r.findings.filter((x) => x.criterionId !== f.criterionId);
        r.findings.push(f);
      }),
    release: async (summary) => {
      try {
        const latest = mustGet(id);
        const payment = await releaseFunds(latest, `Work accepted: ${summary}`);
        updateMilestone(id, (x) => {
          x.payment = { ...x.payment, ...payment };
          x.status = 'released';
          pushEvent(x, 'agent', 'verified', `AI reviewer verified every criterion: ${summary}`);
          pushEvent(x, 'paypal', 'captured', `PayPal captured ${money(Number(x.amount), x.currency)} (capture ${payment.captureId})`);
          pushPayoutEvent(x, payment);
        });
        return null;
      } catch (error) {
        return (error as Error).message.slice(0, 300);
      }
    },
    requestChanges: async (feedback, summary) => {
      patchReview((r, x) => {
        r.feedback = feedback;
        x.status = 'changes_requested';
        pushEvent(x, 'agent', 'changes_requested', `AI reviewer asked for changes: ${summary}`);
      });
    },
    escalate: async (reason, summary) => {
      patchReview((r, x) => {
        r.feedback = reason;
        x.status = 'escalated';
        pushEvent(x, 'agent', 'escalated', `AI reviewer escalated to the client: ${summary}`);
      });
    },
  };

  try {
    const outcome =
      review.engine === 'claude' ? await runClaudeReview(m, submission, hooks) : await runSimulatedReview(m, submission, hooks);
    patchReview((r) => {
      r.decision = outcome.decision;
      r.summary = outcome.summary;
      r.usage = outcome.usage;
      r.finishedAt = nowIso();
    });
  } catch (error) {
    const claude = claudeErrorMessage(error);
    const message = claude ? `Claude API error: ${claude}` : (error as Error).message;
    patchReview((r, x) => {
      r.log.push({ at: nowIso(), kind: 'error', text: message.slice(0, 400) });
      r.decision = 'escalate';
      r.finishedAt = nowIso();
      if (x.status === 'reviewing') {
        x.status = 'escalated';
        pushEvent(x, 'system', 'review_failed', 'The automated review failed, so the client decides. The money stays on hold.');
      }
    });
  }
}

// A review runs in the background of the request that started it; if the server restarts
// meanwhile, nothing would ever finish it.
const STUCK_REVIEW_MS = 15 * 60_000;

/** The milestone, with a pending PayPal payout's status brought up to date. */
export async function readMilestone(id: string): Promise<Milestone | undefined> {
  const m = getMilestone(id);
  if (!m) return undefined;
  const last = m.reviews.at(-1);
  if (m.status === 'reviewing' && last && !last.finishedAt && Date.now() - +new Date(last.startedAt) > STUCK_REVIEW_MS) {
    return updateMilestone(id, (x) => {
      const r = x.reviews.at(-1)!;
      r.log.push({ at: nowIso(), kind: 'error', text: 'The review never finished (the server may have restarted).' });
      r.decision = 'escalate';
      r.finishedAt = nowIso();
      x.status = 'escalated';
      pushEvent(x, 'system', 'review_failed', 'The automated review did not finish, so the client decides. The money stays on hold.');
    });
  }
  const status = await refreshPayoutStatus(m);
  if (!status) return m;
  return updateMilestone(id, (x) => {
    x.payment.payoutStatus = status;
    if (status === 'SUCCESS') pushEvent(x, 'paypal', 'payout_completed', `PayPal payout completed: the money reached ${x.freelancer.email}`);
  });
}

export async function clientDecision(id: string, action: 'approve' | 'request_changes' | 'cancel', note: string, key: string | null): Promise<Milestone> {
  const m = mustGet(id);
  requireRole(m, key, 'client');
  if (action === 'approve') {
    if (!['funded', 'escalated', 'changes_requested'].includes(m.status)) throw new EscrowError(`Cannot release while ${m.status}.`);
    const payment = await releaseFunds(m, note || 'Released by the client');
    return updateMilestone(id, (x) => {
      x.payment = { ...x.payment, ...payment };
      x.status = 'released';
      pushEvent(x, 'client', 'approved', `${x.client.name} approved the work and released the payment${note ? `: ${note}` : ''}`);
      pushEvent(x, 'paypal', 'captured', `PayPal captured ${money(Number(x.amount), x.currency)} (capture ${payment.captureId})`);
      pushPayoutEvent(x, payment);
    });
  }
  if (action === 'request_changes') {
    // Only makes sense once there is a reviewed submission to send back.
    if (m.status !== 'escalated') throw new EscrowError(`Cannot request changes while ${m.status}.`);
    return updateMilestone(id, (x) => {
      x.status = 'changes_requested';
      const r = x.reviews.at(-1);
      if (r) r.feedback = note || r.feedback;
      pushEvent(x, 'client', 'changes_requested', `${x.client.name} asked for changes${note ? `: ${note}` : ''}`);
    });
  }
  if (['released', 'cancelled', 'reviewing'].includes(m.status)) throw new EscrowError(`Cannot cancel while ${m.status}.`);
  const payment = await cancelFunding(m);
  return updateMilestone(id, (x) => {
    x.payment = { ...x.payment, ...payment };
    x.status = 'cancelled';
    pushEvent(x, 'client', 'cancelled', `${x.client.name} cancelled the milestone; the PayPal hold was voided, nothing was charged`);
  });
}

const DraftCriteria = z.object({
  criteria: z.array(z.string()).describe('3 to 6 acceptance criteria, each objectively checkable from a submission'),
});

export async function draftCriteria(title: string, description: string): Promise<string[]> {
  if (!isClaudeConfigured()) {
    return [
      `The deliverable for "${title}" is provided as a link or file`,
      'All requested items from the description are included',
      'The work is original and in the agreed format',
    ];
  }
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: REVIEW_MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: zodOutputFormat(DraftCriteria) },
    messages: [
      {
        role: 'user',
        content: `A client is about to pay a freelancer through an escrow that releases the money only when an AI reviewer can verify acceptance criteria from the freelancer's submission (notes, links, images, files).

Write 3 to 6 acceptance criteria for this job. Each must be specific, objectively checkable from a submission, and fair to the freelancer (no hidden requirements). Write them as short statements, no numbering.

Title: ${title}
Description: ${description || '(none)'}`,
      },
    ],
  });
  return response.parsed_output?.criteria.slice(0, 6) ?? [];
}

function pushPayoutEvent(m: Milestone, payment: Partial<Milestone['payment']>) {
  if (payment.payoutBatchId) pushEvent(m, 'paypal', 'payout', `Payout sent to ${m.freelancer.email} (batch ${payment.payoutBatchId})`);
  else if (payment.payoutStatus) pushEvent(m, 'system', 'payout_failed', `Payout not sent: ${payment.payoutStatus}`);
}

function mustGet(id: string): Milestone {
  const m = getMilestone(id);
  if (!m) throw new EscrowError('Milestone not found', 404);
  return m;
}
