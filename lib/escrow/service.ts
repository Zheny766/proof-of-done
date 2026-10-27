import 'server-only';
// Every milestone state change goes through here, so status, payment and timeline stay in sync.

import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { roleFor, newAccess } from './access.ts';
import { sniffType } from './evidence.ts';
import { cancelFunding, completeFunding, holdNeedsRenewal, paymentMode, payOutHeld, refreshPayoutStatus, releaseFunds, renewHold, startFunding } from './payments.ts';
import { claudeErrorMessage, isClaudeConfigured } from '../ai.ts';
import { onPayPalCall } from '../paypal.ts';
import { REVIEW_MODEL, runClaudeAudit, runClaudeReview, runSimulatedAudit, runSimulatedReview, type ReviewHooks } from './reviewer.ts';
import { demoFile, loadReplay, runReplayReview } from './replay.ts';
import { getMilestone, insertMilestone, listMilestones, newId, nowIso, pushEvent, updateMilestone, UPLOAD_DIR } from './store.ts';
import { CLAIM_LIMIT, scripted, trustFor, type Trust } from './trust.ts';

export { CLAIM_LIMIT, trustFor, type Trust, type TrustTier } from './trust.ts';
import type { Attachment, Milestone, Review, Role } from './types.ts';

export class EscrowError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const money = (n: number, ccy: string) => `${n.toFixed(2)} ${ccy}`;

// Money operations on one milestone run one at a time (two tabs, a double click, a poll racing a
// click), so every status check sees the result of the previous operation.
const queues = new Map<string, Promise<unknown>>();
// Which milestone the running operation belongs to, so its PayPal calls land in its ledger.
const working = new AsyncLocalStorage<string>();
onPayPalCall((call) => {
  const id = working.getStore();
  if (id && getMilestone(id)) updateMilestone(id, (x) => void (x.paypalCalls = [...(x.paypalCalls ?? []), call].slice(-60)));
});
function exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const inContext = () => working.run(id, fn);
  const run = (queues.get(id) ?? Promise.resolve()).then(inContext, inContext);
  const tail = run.catch(() => {});
  queues.set(id, tail);
  void tail.then(() => queues.get(id) === tail && queues.delete(id));
  return run;
}

function requireRole(m: Milestone, key: string | null, role: Exclude<Role, 'viewer'>) {
  if (roleFor(m, key) !== role) {
    throw new EscrowError(role === 'client' ? 'Only the client can do this - open the client link.' : 'Only the freelancer can do this - open the freelancer link.', 403);
  }
}

export const CreateMilestoneInput = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(4000).default(''),
  criteria: z.array(z.string().trim().min(3).max(300)).min(1).max(12),
  // At least $1: anything smaller rounds to 0.00, which PayPal refuses.
  amount: z.coerce.number().min(1).max(10_000),
  // USD only for now: the dashboard and the home page totals add amounts up as dollars.
  currency: z.literal('USD').default('USD'),
  clientName: z.string().trim().min(1).max(80),
  clientEmail: z.email(),
  // Not needed for a job on the open board: whoever takes it gives their name and PayPal email then.
  freelancerName: z.string().trim().min(1).max(80).optional(),
  freelancerEmail: z.email().optional(),
  postToBoard: z.boolean().default(false),
  // An agent that posts for the client says so; the client still has to approve the payment in PayPal.
  postedBy: z.string().trim().min(1).max(80).optional(),
  releaseThreshold: z.coerce.number().min(0.5).max(0.99).default(0.8),
  // Capped well inside PayPal's 3-day honor period, so the capture after the window still goes through.
  objectionHours: z.coerce.number().int().min(0).max(48).default(0),
});

export function createMilestone(raw: unknown): Milestone {
  const input = CreateMilestoneInput.parse(raw);
  if (!input.postToBoard && (!input.freelancerName || !input.freelancerEmail)) {
    throw new EscrowError('Add the freelancer, or post the job on the open board.');
  }
  const m: Milestone = {
    id: newId('ms'),
    title: input.title,
    description: input.description,
    criteria: input.criteria.map((text, i) => ({ id: `c${i + 1}`, text })),
    amount: input.amount.toFixed(2),
    currency: input.currency,
    client: { name: input.clientName, email: input.clientEmail },
    freelancer: input.postToBoard ? { name: 'Anyone on the board', email: '' } : { name: input.freelancerName!, email: input.freelancerEmail! },
    releaseThreshold: input.releaseThreshold,
    objectionHours: input.objectionHours,
    status: 'awaiting_funding',
    payment: { mode: paymentMode() },
    submissions: [],
    reviews: [],
    timeline: [],
    access: newAccess(),
    ...(input.postToBoard && { board: { postedAt: nowIso() } }),
    ...(input.postedBy && { postedBy: input.postedBy }),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  pushEvent(
    m,
    'client',
    'created',
    input.postedBy
      ? `${input.postedBy} posted the job for ${m.client.name}: ${money(input.amount, m.currency)}, waiting for ${m.client.name} to approve the payment`
      : `${m.client.name} created the milestone for ${money(input.amount, m.currency)}`,
  );
  if (input.postToBoard) pushEvent(m, 'client', 'posted', 'Posted on the open job board: it is listed once PayPal holds the money');
  return insertMilestone(m);
}

// A project: several stages, each its own milestone with its own criteria and its own PayPal
// authorization, sharing the client's and the freelancer's links. A stage is funded when it starts,
// after the one before it is paid, so PayPal's 3-day guarantee covers the work actually in progress
// and the client never has more on hold than the current stage.
export const CreateProjectInput = CreateMilestoneInput.omit({ criteria: true, amount: true, postToBoard: true }).extend({
  stages: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(120),
        amount: z.coerce.number().min(1).max(10_000),
        criteria: z.array(z.string().trim().min(3).max(300)).min(1).max(12),
      }),
    )
    .min(2)
    .max(6),
});

export function createProject(raw: unknown): Milestone[] {
  const input = CreateProjectInput.parse(raw);
  if (!input.freelancerName || !input.freelancerEmail) throw new EscrowError('A project needs the freelancer: projects are not posted on the open board.');
  const projectId = newId('prj');
  const access = newAccess();
  const stages = input.stages.map((st) =>
    createMilestone({ ...input, title: `${input.title}: ${st.title}`, amount: st.amount, criteria: st.criteria, postToBoard: false }),
  );
  const stageIds = stages.map((m) => m.id);
  return stages.map((m, i) =>
    updateMilestone(m.id, (x) => {
      x.access = { ...access };
      x.project = { id: projectId, title: input.title, stage: i + 1, stageIds };
      x.timeline = [];
      pushEvent(
        x,
        'client',
        'created',
        `${input.postedBy ? `${input.postedBy} posted` : `${x.client.name} created`} stage ${i + 1} of ${stageIds.length} of "${input.title}" for ${money(Number(x.amount), x.currency)}`,
      );
    }),
  );
}

export type StageSummary = { id: string; stage: number; title: string; amount: string; currency: string; status: Milestone['status'] };

/** Every stage of the project this milestone belongs to, in order (what anyone with the page sees). */
export function projectStages(m: Milestone): StageSummary[] | null {
  if (!m.project) return null;
  return m.project.stageIds.flatMap((sid, i) => {
    const x = getMilestone(sid);
    return x ? [{ id: x.id, stage: i + 1, title: x.title.replace(`${m.project!.title}: `, ''), amount: x.amount, currency: x.currency, status: x.status }] : [];
  });
}

/** The stage before this one, if it hasn't been paid (or cancelled) yet. */
function unfinishedEarlierStage(m: Milestone): Milestone | undefined {
  if (!m.project || m.project.stage === 1) return undefined;
  const prev = getMilestone(m.project.stageIds[m.project.stage - 2]);
  return prev && !['released', 'cancelled'].includes(prev.status) ? prev : undefined;
}

export const beginFunding = (id: string, key: string | null) => exclusive(id, () => beginFundingNow(id, key));
async function beginFundingNow(id: string, key: string | null): Promise<{ orderId: string }> {
  const m = mustGet(id);
  requireRole(m, key, 'client');
  if (m.status !== 'awaiting_funding') throw new EscrowError('This milestone is already funded.');
  const earlier = unfinishedEarlierStage(m);
  if (earlier) throw new EscrowError(`Stage ${earlier.project!.stage} isn't paid yet. Each stage is funded when it starts, so fund this one after that.`, 409);
  const { orderId } = await startFunding(m);
  updateMilestone(id, (x) => {
    x.payment.orderId = orderId;
    x.payment.mode = paymentMode();
  });
  return { orderId };
}

export const confirmFunding = (id: string, orderId: string, key: string | null) => exclusive(id, () => confirmFundingNow(id, orderId, key));
async function confirmFundingNow(id: string, orderId: string, key: string | null): Promise<Milestone> {
  const m = mustGet(id);
  requireRole(m, key, 'client');
  if (m.status !== 'awaiting_funding') return m;
  // Only the order we created for this milestone can fund it.
  if (!m.payment.orderId || m.payment.orderId !== orderId) throw new EscrowError('Order does not belong to this milestone.');
  const payment = await completeFunding(orderId, { amount: m.amount, currency: m.currency });
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

// `replay` is set only by deliverDemo (never from a request): the review plays a recording back.
type SubmitInput = { notes: string; links: string[]; files: IncomingFile[]; payoutEmail?: string; replay?: string };

// Queued with the money operations, so a submission can't slip in while a cancel is waiting on PayPal.
export const submitWork = (id: string, input: SubmitInput, key: string | null) => exclusive(id, async () => submitWorkNow(id, input, key));
function submitWorkNow(id: string, input: SubmitInput, key: string | null): { milestone: Milestone; reviewId: string } {
  const m = mustGet(id);
  requireRole(m, key, 'freelancer');
  // The person getting paid decides where the money goes; the client only suggested an address.
  if (input.payoutEmail !== undefined && !z.email().safeParse(input.payoutEmail).success) {
    throw new EscrowError('Enter a valid PayPal email for the payout.');
  }
  const payoutEmail = input.payoutEmail;
  if (!['funded', 'changes_requested'].includes(m.status)) throw new EscrowError(`Cannot submit work while the milestone is ${m.status}.`);
  if (!input.notes.trim() && input.links.length === 0 && input.files.length === 0) throw new EscrowError('Add notes, a link or a file.');

  const submissionId = newId('sub');
  const dir = path.join(UPLOAD_DIR, id, submissionId);
  fs.mkdirSync(dir, { recursive: true });
  const attachments: Attachment[] = input.files.slice(0, 8).map((f, i) => {
    const safe = f.name.replace(/[^\w.\-]+/g, '_').slice(-80) || `file${i}`;
    const rel = path.join(id, submissionId, `${i}_${safe}`);
    fs.writeFileSync(path.join(UPLOAD_DIR, rel), f.bytes);
    return { id: newId('att'), name: f.name, mime: sniffType(f.bytes, f.type), size: f.bytes.length, file: rel, sha256: crypto.createHash('sha256').update(f.bytes).digest('hex') };
  });

  const reviewId = newId('rev');
  const replay = input.replay ? loadReplay(input.replay) : null;
  const live = isClaudeConfigured() && (!m.demo || demoReviewsLeft());
  const milestone = updateMilestone(id, (x) => {
    if (payoutEmail && payoutEmail !== x.freelancer.email) {
      x.freelancer.email = payoutEmail;
      pushEvent(x, 'freelancer', 'payout_email', `${x.freelancer.name} set the PayPal email for the payout`);
    }
    x.submissions.push({ id: submissionId, at: nowIso(), notes: input.notes.trim(), links: input.links, attachments });
    x.settlement = undefined;
    x.reviews.push({
      id: reviewId,
      submissionId,
      startedAt: nowIso(),
      engine: replay ? 'replay' : live ? 'claude' : 'simulated',
      model: replay ? replay.model : live ? REVIEW_MODEL : undefined,
      recordedAt: replay?.recordedAt,
      findings: [],
      log: [],
    });
    x.status = 'reviewing';
    pushEvent(x, 'freelancer', 'submitted', `${x.freelancer.name} submitted the work (${attachments.length} file(s), ${input.links.length} link(s))`);
    pushEvent(x, 'agent', 'review_started', 'The AI reviewer started checking the work against the acceptance criteria');
  });
  return { milestone, reviewId };
}

// Deals anyone can open on the hosted demo (board demo jobs, the challenge) get live Claude reviews up
// to a daily cap; after that they fall back to the simulated reviewer, so a visitor can't run up the bill.
const DEMO_REVIEWS_DAILY = () => Number(process.env.POD_DEMO_REVIEWS_DAILY ?? 60);
function demoReviewsLeft(): boolean {
  const since = Date.now() - 86_400_000;
  const used = listMilestones().filter((x) => x.demo && x.reviews.some((r) => r.engine === 'claude' && Date.parse(r.startedAt) > since)).length;
  return used < DEMO_REVIEWS_DAILY();
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
    audit: async (input) => {
      const audit = review.engine === 'claude' ? await runClaudeAudit(m, submission, input) : runSimulatedAudit();
      patchReview((r) => {
        r.audit = audit;
      });
      return audit;
    },
    release: (summary) =>
      exclusive(id, async () => {
        try {
          const latest = mustGet(id);
          if (latest.status !== 'reviewing') return { error: `the milestone is ${latest.status} now` };
          // Someone on probation gets paid only with the client's OK, however good this delivery looks.
          const trust = trustFor(latest.freelancer.email, id);
          if (trust.tier === 'probation' && !scripted(latest)) {
            updateMilestone(id, (x) => {
              x.status = 'escalated';
              pushEvent(x, 'agent', 'verified_probation', `AI reviewer verified every criterion: ${summary}`);
              pushEvent(x, 'system', 'probation', `${x.freelancer.name} is on probation (${trust.reason}), so ${x.client.name} approves this payment`);
            });
            return { error: `${latest.freelancer.name} is on probation (${trust.reason}); the client approves this payment` };
          }
          const hours = latest.objectionHours ?? 0;
          // The client asked for time to object: the money moves when the window closes.
          if (hours > 0) {
            const releaseAt = new Date(Date.now() + hours * 3_600_000).toISOString();
            updateMilestone(id, (x) => {
              x.status = 'verified';
              x.releaseAt = releaseAt;
              pushEvent(x, 'agent', 'verified', `AI reviewer verified every criterion: ${summary}`);
              pushEvent(x, 'system', 'release_scheduled', `The payment goes out in ${hours} h unless ${x.client.name} objects`);
            });
            scheduleRelease(id, releaseAt);
            return { releaseAt };
          }
          const payment = await releaseFunds(latest, `Work accepted: ${summary}`);
          updateMilestone(id, (x) => {
            mergeRelease(x, payment);
            x.status = 'released';
            pushEvent(x, 'agent', 'verified', `AI reviewer verified every criterion: ${summary}`);
            pushEvent(x, 'paypal', 'captured', `PayPal captured ${money(Number(x.amount), x.currency)} (capture ${payment.captureId})`);
            pushPayoutEvent(x, payment);
          });
          return {};
        } catch (error) {
          return { error: (error as Error).message.slice(0, 300) };
        }
      }),
    // A review that outlived the stuck-review timeout must not overwrite what happened since.
    requestChanges: async (feedback, summary) => {
      patchReview((r, x) => {
        r.feedback = feedback;
        if (x.status !== 'reviewing') return;
        x.status = 'changes_requested';
        pushEvent(x, 'agent', 'changes_requested', `AI reviewer asked for changes: ${summary}`);
      });
    },
    escalate: async (reason, summary) => {
      patchReview((r, x) => {
        r.feedback = reason;
        if (x.status !== 'reviewing') return;
        x.status = 'escalated';
        pushEvent(x, 'agent', 'escalated', `AI reviewer escalated to the client: ${summary}`);
      });
    },
  };

  try {
    const replay = review.engine === 'replay' && m.demo ? loadReplay(m.demo.scenario) : null;
    const outcome = replay
      ? await runReplayReview(replay, { ...hooks, setAudit: (a) => patchReview((r) => void (r.audit = a)) })
      : review.engine === 'claude'
        ? await runClaudeReview(m, submission, hooks)
        : await runSimulatedReview(m, submission, hooks);
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
  if (m.status === 'verified' && m.releaseAt && Date.parse(m.releaseAt) <= Date.now()) return releaseWhenDue(id);
  if (HOLDING.includes(m.status) && holdNeedsRenewal(m.payment) && retryDue(m.payment.reauthTriedAt)) return renewHoldNow(id);
  if (!['PENDING', 'PROCESSING'].includes(m.payment.payoutStatus ?? '')) return m;
  return exclusive(id, async () => {
    const latest = mustGet(id);
    const status = await refreshPayoutStatus(latest);
    if (!status) return latest;
    return updateMilestone(id, (x) => {
      x.payment.payoutStatus = status;
      if (status === 'SUCCESS') pushEvent(x, 'paypal', 'payout_completed', `PayPal payout completed: the money reached ${x.freelancer.email}`);
    });
  });
}

const HOLDING = ['funded', 'reviewing', 'changes_requested', 'escalated', 'verified'];
const retryDue = (triedAt?: string) => !triedAt || Date.now() - Date.parse(triedAt) > 6 * 3_600_000;

// The job is outlasting PayPal's 3-day guarantee on the held money: reauthorize, once.
function renewHoldNow(id: string): Promise<Milestone> {
  return exclusive(id, async () => {
    const m = mustGet(id);
    if (!HOLDING.includes(m.status)) return m;
    try {
      const renewed = await renewHold(m);
      if (!renewed) return m;
      return updateMilestone(id, (x) => {
        x.payment = { ...x.payment, ...renewed, reauthTriedAt: undefined };
        pushEvent(x, 'paypal', 'reauthorized', `PayPal reauthorized the hold after its 3-day honor period: ${money(Number(x.amount), x.currency)} is guaranteed again (authorization ${renewed.authorizationId})`);
      });
    } catch (error) {
      return updateMilestone(id, (x) => {
        x.payment.reauthTriedAt = nowIso();
        pushEvent(x, 'system', 'reauth_failed', `PayPal did not renew the hold (${(error as Error).message.slice(0, 160)}). It is still in place but no longer guaranteed; a capture may fail.`);
      });
    }
  });
}

// The objection window closed without an objection: release the money. Runs on a timer, and again
// whenever the milestone is read, in case the server restarted in between.
function releaseWhenDue(id: string): Promise<Milestone> {
  return exclusive(id, async () => {
    const m = mustGet(id);
    if (m.status !== 'verified' || !m.releaseAt || Date.parse(m.releaseAt) > Date.now()) return m;
    try {
      const payment = await releaseFunds(m, 'Work accepted: verified, and the objection window closed');
      return updateMilestone(id, (x) => {
        mergeRelease(x, payment);
        x.status = 'released';
        x.releaseAt = undefined;
        pushEvent(x, 'system', 'window_closed', `${x.client.name} did not object within ${x.objectionHours} h, so the payment goes out`);
        pushEvent(x, 'paypal', 'captured', `PayPal captured ${money(Number(x.amount), x.currency)} (capture ${payment.captureId})`);
        pushPayoutEvent(x, payment);
      });
    } catch (error) {
      // Nothing was captured; the client decides what happens with the hold.
      return updateMilestone(id, (x) => {
        x.status = 'escalated';
        x.releaseAt = undefined;
        pushEvent(x, 'system', 'release_failed', `Releasing the payment failed (${(error as Error).message.slice(0, 160)}). The client decides.`);
      });
    }
  });
}

function scheduleRelease(id: string, releaseAt: string) {
  const timer = setTimeout(() => void releaseWhenDue(id).catch(() => {}), Math.max(0, Date.parse(releaseAt) - Date.now()) + 1000);
  timer.unref?.();
}

export const clientDecision = (id: string, action: 'approve' | 'request_changes' | 'cancel', note: string, key: string | null) =>
  exclusive(id, () => clientDecisionNow(id, action, note, key));
async function clientDecisionNow(id: string, action: 'approve' | 'request_changes' | 'cancel', note: string, key: string | null): Promise<Milestone> {
  const m = mustGet(id);
  requireRole(m, key, 'client');
  if (action === 'approve') {
    if (!['funded', 'escalated', 'changes_requested', 'verified'].includes(m.status)) throw new EscrowError(`Cannot release while ${m.status}.`);
    const payment = await releaseFunds(m, note || 'Released by the client');
    return updateMilestone(id, (x) => {
      mergeRelease(x, payment);
      x.status = 'released';
      x.releaseAt = undefined;
      x.settlement = undefined;
      pushEvent(x, 'client', 'approved', `${x.client.name} approved the work and released the payment${note ? `: ${note}` : ''}`);
      pushEvent(x, 'paypal', 'captured', `PayPal captured ${money(Number(x.amount), x.currency)} (capture ${payment.captureId})`);
      pushPayoutEvent(x, payment);
    });
  }
  if (action === 'request_changes') {
    // Only makes sense once there is a reviewed submission to send back. In the objection window
    // this is the client's objection to the AI's verdict.
    if (m.status !== 'escalated' && m.status !== 'verified') throw new EscrowError(`Cannot request changes while ${m.status}.`);
    return updateMilestone(id, (x) => {
      const objected = x.status === 'verified';
      x.status = 'changes_requested';
      x.releaseAt = undefined;
      const r = x.reviews.at(-1);
      if (r) r.feedback = note || (objected ? 'The client objected to the verification.' : r.feedback);
      pushEvent(x, 'client', 'changes_requested', `${x.client.name} ${objected ? 'objected and asked' : 'asked'} for changes${note ? `: ${note}` : ''}`);
    });
  }
  if (['released', 'cancelled', 'reviewing'].includes(m.status)) throw new EscrowError(`Cannot cancel while ${m.status}.`);
  const payment = await cancelFunding(m);
  return updateMilestone(id, (x) => {
    x.payment = { ...x.payment, ...payment };
    x.status = 'cancelled';
    x.releaseAt = undefined;
    x.settlement = undefined;
    pushEvent(
      x,
      'client',
      'cancelled',
      m.payment.authorizationId
        ? `${x.client.name} cancelled the milestone; the PayPal hold was voided, nothing was charged`
        : `${x.client.name} cancelled the milestone before funding it`,
    );
  });
}

// Settling for part of the money: when the work is partly done and the two sides agree on an amount.
// Either party proposes, only the other one can accept, and accepting captures just that amount.
const SETTLE_STATES = ['changes_requested', 'escalated'];

export type SettlementAction = { action: 'propose'; amount: number; note?: string } | { action: 'accept' } | { action: 'decline' };

export const settle = (id: string, input: SettlementAction, key: string | null) => exclusive(id, () => settleNow(id, input, key));
async function settleNow(id: string, input: SettlementAction, key: string | null): Promise<Milestone> {
  const m = mustGet(id);
  const role = roleFor(m, key);
  if (role === 'viewer') throw new EscrowError('Only the client or the freelancer can settle - open your link.', 403);
  const name = role === 'client' ? m.client.name : m.freelancer.name;
  const offer = m.settlement;

  if (input.action === 'propose') {
    if (!SETTLE_STATES.includes(m.status)) throw new EscrowError(`Cannot settle while ${m.status}.`);
    const amount = Math.round(input.amount * 100) / 100;
    if (!(amount >= 1 && amount < Number(m.amount))) {
      throw new EscrowError(`Offer between ${money(1, m.currency)} and less than ${money(Number(m.amount), m.currency)}; for the full amount, approve the work.`);
    }
    const note = (input.note ?? '').trim().slice(0, 500);
    return updateMilestone(id, (x) => {
      x.settlement = { by: role, amount: amount.toFixed(2), note, at: nowIso() };
      pushEvent(x, role, 'settlement_offer', `${name} offered to settle for ${money(amount, x.currency)} of ${money(Number(x.amount), x.currency)}${note ? `: ${note}` : ''}`);
    });
  }

  if (!offer) throw new EscrowError('There is no open offer.');
  if (input.action === 'decline') {
    return updateMilestone(id, (x) => {
      x.settlement = undefined;
      pushEvent(x, role, 'settlement_declined', offer.by === role ? `${name} withdrew the offer` : `${name} declined the offer of ${money(Number(offer.amount), x.currency)}`);
    });
  }

  if (offer.by === role) throw new EscrowError('The other party has to accept your offer.', 403);
  if (!SETTLE_STATES.includes(m.status)) throw new EscrowError(`Cannot settle while ${m.status}.`);
  const payment = await releaseFunds(m, `Settled for ${offer.amount} ${m.currency} of ${m.amount}`, offer.amount);
  return updateMilestone(id, (x) => {
    mergeRelease(x, payment);
    x.status = 'released';
    x.settlement = undefined;
    const rest = Number(x.amount) - Number(offer.amount);
    pushEvent(x, role, 'settled', `${name} accepted: settled for ${money(Number(offer.amount), x.currency)}`);
    pushEvent(
      x,
      'paypal',
      'captured',
      `PayPal captured ${money(Number(offer.amount), x.currency)} (capture ${payment.captureId}); the other ${money(rest, x.currency)} of the hold went back to ${x.client.name}`,
    );
    pushPayoutEvent(x, payment);
  });
}

// The open job board: funded jobs any AI agent (or person) can take. Taking one gives the taker a
// fresh freelancer key, so only they can deliver; a claim with no delivery lapses after a day.
const CLAIM_MS = 24 * 3_600_000;

const claimActive = (m: Milestone) => !!m.board?.claimedAt && (m.submissions.length > 0 || Date.now() - Date.parse(m.board.claimedAt) < CLAIM_MS);
export const isOpenJob = (m: Milestone) => !!m.board && m.status === 'funded' && m.submissions.length === 0 && !claimActive(m);

/** Open jobs, newest first. The money is already on hold for each one. */
export function openJobs(): Milestone[] {
  ensureBoardDemoJobs();
  return listMilestones()
    .filter(isOpenJob)
    .sort((a, b) => b.board!.postedAt.localeCompare(a.board!.postedAt));
}

/** Jobs from the board that someone took, newest first: who took them and how they ended. */
export const takenJobs = (limit = 6): Milestone[] =>
  listMilestones()
    .filter((m) => m.board?.claimedAt)
    .sort((a, b) => b.board!.claimedAt!.localeCompare(a.board!.claimedAt!))
    .slice(0, limit);

/**
 * The track record of whoever took jobs from the board: what the reviewer and PayPal confirmed, never
 * what the taker claims. Grouped by name and payout address (shown by name only).
 */
export function boardRecords() {
  const rows = new Map<string, { name: string; taken: number; paid: number; held: number; working: number; earned: number; demo: boolean }>();
  for (const m of listMilestones()) {
    if (!m.board?.claimedAt) continue;
    const key = `${m.board.claimedBy}\u0000${m.freelancer.email}`;
    const r = rows.get(key) ?? { name: m.board.claimedBy!, taken: 0, paid: 0, held: 0, working: 0, earned: 0, demo: true };
    r.demo &&= m.description.startsWith('[Demo data]');
    r.taken++;
    if (m.status === 'released') {
      r.paid++;
      r.earned += Number(m.payment.capturedAmount ?? m.amount);
    } else if (['funded', 'reviewing', 'verified'].includes(m.status)) r.working++;
    else r.held++;
    rows.set(key, r);
  }
  const all = listMilestones();
  const emails = new Map<string, string>();
  for (const m of all) if (m.board?.claimedAt) emails.set(`${m.board.claimedBy}\u0000${m.freelancer.email}`, m.freelancer.email);
  return [...rows.entries()]
    .map(([key, r]) => ({ ...r, tier: trustFor(emails.get(key) ?? '', undefined, all).tier }))
    .sort((a, b) => b.earned - a.earned || b.paid - a.paid);
}

export const ClaimJobInput = z.object({
  name: z.string().trim().min(1).max(80),
  payoutEmail: z.email(),
});

export const claimJob = (id: string, raw: unknown) => exclusive(id, async () => claimJobNow(id, ClaimJobInput.parse(raw)));
function claimJobNow(id: string, input: z.infer<typeof ClaimJobInput>): { milestone: Milestone; freelancerKey: string; trust: Trust } {
  const m = mustGet(id);
  if (!m.board) throw new EscrowError('This job is not on the open board.', 404);
  if (!isOpenJob(m)) throw new EscrowError(claimActive(m) ? 'Someone already took this job.' : 'This job is not open: it has no PayPal hold or it is already done.', 409);
  // Taking a job blocks it for everyone else, so how many one taker can hold depends on their record.
  const trust = trustFor(input.payoutEmail);
  const holding = listMilestones().filter((x) => x.board && claimActive(x) && x.status === 'funded' && !x.submissions.length && x.freelancer.email.toLowerCase() === input.payoutEmail.toLowerCase()).length;
  if (holding >= CLAIM_LIMIT[trust.tier]) {
    throw new EscrowError(`Deliver the job you already took first: with your record (${trust.tier}) you can hold ${CLAIM_LIMIT[trust.tier]} at a time.`, 429);
  }
  const freelancerKey = newAccess().freelancerKey;
  const milestone = updateMilestone(id, (x) => {
    x.access = { ...x.access!, freelancerKey };
    x.freelancer = { name: input.name, email: input.payoutEmail };
    x.board = { ...x.board!, claimedAt: nowIso(), claimedBy: input.name };
    pushEvent(x, 'freelancer', 'claimed', `${input.name} took the job from the open board`);
  });
  return { milestone, freelancerKey, trust };
}

// The hosted demo keeps a few jobs on the board (simulated holds), so a visitor's agent always has
// something to take. Only where POD_SEED_BOARD is set.
const BOARD_DEMO_JOBS = [
  {
    title: 'Spanish menu for a cafe',
    description: 'Translate the Ember & Oak cafe menu into Spanish for a new Madrid branch. The items: Espresso $3.00, Cappuccino $4.25, Oat latte $4.75, Hot chocolate $4.50, Iced tea $3.75, Fresh orange juice $4.50, Butter croissant $3.50, Almond croissant $4.25, Avocado toast $9.50, Ham and cheese sandwich $8.75, Granola bowl $8.50, Banana bread $3.75.',
    criteria: ['Delivered as a Markdown or text file', 'All 12 items have Spanish names', 'Every price is unchanged', 'The cafe name stays EMBER & OAK'],
    amount: 40,
  },
  {
    title: 'README for a tiny CLI tool',
    description: 'Write the README for "brisk", a command-line timer. "brisk 25m" starts a 25-minute timer, "brisk --list" shows past timers, "brisk --sound off" mutes the bell. It installs with "npm i -g brisk-timer". MIT licence.',
    criteria: ['Delivered as a Markdown file', 'Explains how to install it', 'Shows all three commands with an example each', 'Mentions the MIT licence'],
    amount: 60,
  },
  {
    title: 'Five product descriptions for a candle shop',
    description: 'Short web-shop descriptions for five soy candles from Wick & Ember: Cedar Smoke, Fig Leaf, Sea Salt, Black Tea, Orange Peel. 40 to 80 words each, warm and plain, no exclamation marks.',
    criteria: ['All five candles have a description', 'Each description is 40 to 80 words', 'No exclamation marks anywhere'],
    amount: 35,
  },
];

function ensureBoardDemoJobs() {
  if (!process.env.POD_SEED_BOARD) return;
  const open = listMilestones().filter((m) => m.demo?.scenario === 'board' && isOpenJob(m));
  for (const job of BOARD_DEMO_JOBS) {
    if (open.some((m) => m.title === job.title)) continue;
    const m = createMilestone({ ...job, clientName: 'Ember & Oak', clientEmail: 'maya@ember-oak.example', postToBoard: true });
    const tag = crypto.randomBytes(5).toString('hex').toUpperCase();
    const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    updateMilestone(m.id, (x) => {
      x.demo = { scenario: 'board' };
      x.payment = { mode: 'simulated', orderId: `ORDER-DEMO-${tag}`, authorizationId: `AUTH-DEMO-${tag}`, authorizationStatus: 'CREATED', authorizedAt: nowIso(), honorExpiresAt: at(3), expiresAt: at(29) };
      x.status = 'funded';
      pushEvent(x, 'paypal', 'authorized', `PayPal authorized ${money(job.amount, x.currency)}: the money is on hold, nothing has been charged yet (demo: simulated hold)`);
    });
  }
}

// "Try it in 60 seconds": a ready deal per scenario, funded with a simulated hold, whose prepared
// delivery is reviewed by playing back a recorded real Claude run.
const DEMO_FREELANCERS: Record<string, [string, string]> = {
  honest: ['Diego Alvarez', 'diego@studio.example'],
  cheater: ['Sam Rivera', 'sam@studio.example'],
  partial: ['Priya Nair', 'priya@studio.example'],
  arena: ['You', 'you@visitor.example'],
};

export function startDemo(scenario: string): Milestone {
  if (scenario === 'arena') arenaCheck();
  // The arena reuses the half-done brunch menu's brief; its delivery is the visitor's own words.
  const replay = loadReplay(scenario === 'arena' ? 'partial' : scenario);
  const freelancer = DEMO_FREELANCERS[scenario];
  if (!replay || !freelancer) throw new EscrowError('Unknown demo scenario.', 404);
  const m = createMilestone({
    title: replay.milestone.title,
    description: replay.milestone.description,
    criteria: replay.milestone.criteria,
    // The recorded reviews mention the amount, so the demo deals use the same one.
    amount: 100,
    clientName: 'Ember & Oak',
    clientEmail: 'maya@ember-oak.example',
    freelancerName: freelancer[0],
    freelancerEmail: freelancer[1],
  });
  const tag = crypto.randomBytes(5).toString('hex').toUpperCase();
  const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  return updateMilestone(m.id, (x) => {
    x.demo = { scenario };
    x.payment = {
      mode: 'simulated',
      orderId: `ORDER-DEMO-${tag}`,
      authorizationId: `AUTH-DEMO-${tag}`,
      authorizationStatus: 'CREATED',
      authorizedAt: nowIso(),
      honorExpiresAt: at(3),
      expiresAt: at(29),
      payerEmail: 'buyer@sandbox.example',
    };
    x.status = 'funded';
    pushEvent(x, 'paypal', 'authorized', `PayPal authorized ${money(100, x.currency)}: the money is on hold, nothing has been charged yet (demo: simulated hold)`);
  });
}

// "Try to fool it": the delivery is a draft that clearly misses the brief (6 items, no logo), and the
// visitor writes whatever notes they like to get it paid anyway. A live Claude review, not a replay,
// so it needs a key, and it is capped per day.
const ARENA_FILE = 'brunch-menu-draft.pdf';
const arenaDaily = () => Number(process.env.POD_ARENA_DAILY ?? 30);
const arenaDeals = () => listMilestones().filter((m) => m.demo?.scenario === 'arena');

function arenaCheck() {
  if (!isClaudeConfigured()) throw new EscrowError('The live challenge needs Claude on the server. The three replayed scenarios work without it.', 503);
  const since = Date.now() - 86_400_000;
  const today = arenaDeals().filter((m) => m.submissions.some((x) => Date.parse(x.at) > since)).length;
  if (today >= arenaDaily() || !demoReviewsLeft()) throw new EscrowError(`Today's live attempts are used up. Come back tomorrow, or try the replayed scenarios.`, 429);
}

export const ArenaInput = z.object({ id: z.string().min(3).max(40), notes: z.string().trim().min(1).max(2000) });

export function deliverArena(raw: unknown, key: string | null) {
  const { id, notes } = ArenaInput.parse(raw);
  const m = mustGet(id);
  if (m.demo?.scenario !== 'arena') throw new EscrowError('This is not a challenge deal.');
  if (m.submissions.length) throw new EscrowError('One attempt per deal: start a new one from the demo page.');
  arenaCheck();
  return submitWork(id, { notes, links: [], files: [{ name: ARENA_FILE, type: 'application/pdf', bytes: demoFile(ARENA_FILE) }] }, key);
}

/** The scoreboard: how many tricks were tried, and how many got the draft paid. */
export function arenaStats() {
  // Only live Claude reviews count: the scoreboard is about what the AI does.
  const tried = arenaDeals().filter((m) => m.reviews.some((r) => r.finishedAt && r.engine === 'claude'));
  return {
    attempts: tried.length,
    // Paid by the AI, that is: a visitor who switches to the client and approves doesn't count.
    paid: tried.filter((m) => m.timeline.some((e) => e.type === 'verified')).length,
    vetoed: tried.filter((m) => m.reviews.some((r) => r.audit && !r.audit.agreed)).length,
    live: isClaudeConfigured(),
  };
}

/** The freelancer hands in the scenario's prepared delivery. */
export function deliverDemo(id: string, key: string | null) {
  const m = mustGet(id);
  const replay = m.demo && loadReplay(m.demo.scenario);
  if (!replay) throw new EscrowError('This is not a demo deal.');
  const files = replay.files.map((name) => ({ name, type: 'application/pdf', bytes: demoFile(name) }));
  return submitWork(id, { notes: replay.notes, links: [], files, replay: m.demo!.scenario }, key);
}

// PayPal webhooks (signature already verified by the route). They bring status changes we would
// otherwise only learn by polling: a pending capture that completed, a payout that arrived or failed,
// an authorization voided on PayPal's side. Each event is applied once.
type WebhookResource = {
  id?: string;
  custom_id?: string;
  payout_batch_id?: string;
  batch_header?: { payout_batch_id?: string };
  payout_item?: { sender_item_id?: string };
  supplementary_data?: { related_ids?: { authorization_id?: string } };
  // Disputes (CUSTOMER.DISPUTE.*): the capture they are about is the seller transaction.
  dispute_id?: string;
  reason?: string;
  status?: string;
  dispute_amount?: { value?: string; currency_code?: string };
  disputed_transactions?: { seller_transaction_id?: string }[];
};
export type WebhookEvent = { id: string; event_type: string; resource?: WebhookResource };

function milestoneForEvent(e: WebhookEvent): Milestone | undefined {
  const r = e.resource ?? {};
  const related = r.supplementary_data?.related_ids ?? {};
  const payoutItem = r.payout_item ?? {};
  return listMilestones().find(
    (m) =>
      (r.custom_id && r.custom_id === m.id) ||
      (payoutItem.sender_item_id && payoutItem.sender_item_id === m.id) ||
      (m.payment.captureId && (r.id === m.payment.captureId || r.disputed_transactions?.some((t) => t.seller_transaction_id === m.payment.captureId))) ||
      (m.payment.authorizationId && (r.id === m.payment.authorizationId || related.authorization_id === m.payment.authorizationId)) ||
      (m.payment.previousAuthorizationId && (r.id === m.payment.previousAuthorizationId || related.authorization_id === m.payment.previousAuthorizationId)) ||
      (m.payment.payoutBatchId && (r.payout_batch_id === m.payment.payoutBatchId || r.batch_header?.payout_batch_id === m.payment.payoutBatchId)),
  );
}

export async function applyWebhook(e: WebhookEvent): Promise<'applied' | 'duplicate' | 'ignored'> {
  const found = milestoneForEvent(e);
  if (!found) return 'ignored';
  return exclusive(found.id, async () => {
    const m = mustGet(found.id);
    if (m.webhookEvents?.includes(e.id)) return 'duplicate';
    const via = `(PayPal webhook ${e.event_type})`;
    let effect: ((x: Milestone) => void) | undefined;
    const type = e.event_type;
    if (type === 'PAYMENT.CAPTURE.COMPLETED' && m.payment.payoutStatus?.startsWith('HELD')) {
      // The capture went through after all: only now does the freelancer get paid.
      const payout = await payOutHeld(m);
      effect = (x) => {
        x.payment = { ...x.payment, ...payout };
        pushEvent(x, 'paypal', 'capture_completed', `PayPal completed the capture, so the payout goes out now ${via}`);
        pushPayoutEvent(x, payout);
      };
    } else if (type === 'PAYMENT.CAPTURE.DENIED' || type === 'PAYMENT.CAPTURE.DECLINED') {
      effect = (x) => {
        x.payment.payoutStatus = 'NOT SENT: PayPal denied the capture';
        pushEvent(x, 'paypal', 'capture_denied', `PayPal denied the capture; nothing is paid out ${via}`);
      };
    } else if (type === 'PAYMENT.AUTHORIZATION.VOIDED' && m.status !== 'cancelled' && m.status !== 'released') {
      effect = (x) => {
        x.payment.authorizationStatus = 'VOIDED';
        x.payment.voidedAt = nowIso();
        x.status = 'cancelled';
        x.releaseAt = undefined;
        x.settlement = undefined;
        pushEvent(x, 'paypal', 'voided', `PayPal voided the authorization; nothing will be charged ${via}`);
      };
    } else if (type === 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED' || type === 'PAYMENT.PAYOUTSBATCH.SUCCESS') {
      effect = (x) => {
        if (x.payment.payoutStatus === 'SUCCESS') return;
        x.payment.payoutStatus = 'SUCCESS';
        pushEvent(x, 'paypal', 'payout_completed', `PayPal payout completed: the money reached ${x.freelancer.email} ${via}`);
      };
    } else if (/^CUSTOMER\.DISPUTE\.(CREATED|UPDATED|RESOLVED)$/.test(type) && e.resource?.dispute_id) {
      // A buyer disputed the payment with PayPal: keep it on the deal, so both sides see it and can
      // answer with the deal's record.
      const r = e.resource;
      const reason = (r.reason ?? 'OTHER').toLowerCase().replace(/_/g, ' ');
      const status = r.status ?? (type.endsWith('RESOLVED') ? 'RESOLVED' : 'OPEN');
      const amount = r.dispute_amount?.value && `${r.dispute_amount.value} ${r.dispute_amount.currency_code ?? ''}`.trim();
      effect = (x) => {
        const list = x.disputes ?? [];
        const known = list.find((d) => d.id === r.dispute_id);
        if (known) Object.assign(known, { status, updatedAt: nowIso() });
        else list.push({ id: r.dispute_id!, reason, status, ...(amount && { amount }), openedAt: nowIso(), updatedAt: nowIso() });
        x.disputes = list;
        pushEvent(
          x,
          'paypal',
          `dispute_${type.split('.').pop()!.toLowerCase()}`,
          known ? `PayPal dispute ${r.dispute_id} is now ${status.toLowerCase().replace(/_/g, ' ')} ${via}` : `The buyer opened PayPal dispute ${r.dispute_id} (${reason}${amount ? `, ${amount}` : ''}) ${via}`,
        );
      };
    } else if (/^PAYMENT\.PAYOUTS-ITEM\.(FAILED|RETURNED|UNCLAIMED|BLOCKED|DENIED|REFUNDED)$/.test(type)) {
      const outcome = type.split('.').pop()!;
      effect = (x) => {
        x.payment.payoutStatus = outcome;
        pushEvent(x, 'system', 'payout_failed', `The PayPal payout was ${outcome.toLowerCase()} ${via}`);
      };
    }
    updateMilestone(m.id, (x) => {
      x.webhookEvents = [...(x.webhookEvents ?? []), e.id].slice(-100);
      effect?.(x);
    });
    return effect ? 'applied' : 'ignored';
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

// Merges a capture's result. A hold renewed on the way (it was past its honor period) goes on the record.
function mergeRelease(x: Milestone, payment: Partial<Milestone['payment']>) {
  if (payment.reauthorizedAt && !x.payment.reauthorizedAt) {
    pushEvent(x, 'paypal', 'reauthorized', `PayPal reauthorized the hold after its 3-day honor period (authorization ${payment.authorizationId}), then captured it`);
  }
  x.payment = { ...x.payment, ...payment };
}

function pushPayoutEvent(m: Milestone, payment: Partial<Milestone['payment']>) {
  if (payment.payoutBatchId) pushEvent(m, 'paypal', 'payout', `Payout sent to ${m.freelancer.email} (batch ${payment.payoutBatchId})`);
  else if (payment.payoutStatus?.startsWith('HELD')) pushEvent(m, 'paypal', 'payout_held', `Payout waits until PayPal completes the capture`);
  else if (payment.payoutStatus) pushEvent(m, 'system', 'payout_failed', `Payout not sent: ${payment.payoutStatus}`);
}

function mustGet(id: string): Milestone {
  const m = getMilestone(id);
  if (!m) throw new EscrowError('Milestone not found', 404);
  return m;
}
