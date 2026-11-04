// A milestone = one piece of work. Its payment is authorized on PayPal up front and captured once
// the work is verified.

export type MilestoneStatus =
  | 'awaiting_funding' // created, client has not authorized payment yet
  | 'funded' // PayPal authorization in place, waiting for the freelancer to deliver
  | 'reviewing' // a submission is being checked by the AI reviewer
  | 'changes_requested' // reviewer found unmet criteria; freelancer can resubmit
  | 'escalated' // reviewer was not confident; the client decides
  | 'verified' // reviewer verified everything; the money moves when the client's objection window closes
  | 'released' // authorization captured, freelancer paid
  | 'cancelled'; // authorization voided, nothing charged

export type CriterionStatus = 'met' | 'not_met' | 'unclear';

export interface Criterion {
  id: string;
  text: string;
  /**
   * 'client': a matter of taste ("the logo feels warm") that the client judges, not the AI. The AI
   * checks the other criteria; with any of these, the money moves only after the client's objection window.
   */
  judge?: 'client';
}

export interface Party {
  name: string;
  email: string;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Path relative to the uploads directory. */
  file: string;
  /** SHA-256 of the file as delivered, hex: the proof certificate lists it, so anyone with the file can check it. */
  sha256?: string;
}

export interface Submission {
  id: string;
  at: string;
  notes: string;
  links: string[];
  attachments: Attachment[];
}

export interface CriterionFinding {
  criterionId: string;
  status: CriterionStatus;
  confidence: number; // 0..1
  evidence: string;
}

export type ReviewDecision = 'release' | 'request_changes' | 'escalate';

export interface AgentLogEntry {
  at: string;
  kind: 'thinking' | 'tool' | 'result' | 'decision' | 'error' | 'info';
  text: string;
}

export interface Review {
  id: string;
  submissionId: string;
  startedAt: string;
  finishedAt?: string;
  /** 'replay': a recorded real Claude review played back (the hosted demo's prepared deliveries). */
  engine: 'claude' | 'simulated' | 'replay';
  model?: string;
  /** When the replayed review was recorded. */
  recordedAt?: string;
  findings: CriterionFinding[];
  decision?: ReviewDecision;
  summary?: string;
  feedback?: string;
  log: AgentLogEntry[];
  usage?: { inputTokens: number; outputTokens: number };
  /** The independent second check that has to confirm a release before any money moves. */
  audit?: Audit;
  /** More independent checks besides the second opinion (Gemini, from another company); all must agree. */
  panel?: Audit[];
}

export interface Audit {
  engine: 'claude' | 'simulated' | 'gemini';
  model?: string;
  agreed: boolean;
  /** The check couldn't run at all (the provider was busy or down), so it gave no verdict. */
  unavailable?: boolean;
  /** For a check that could not answer: whether the release needed it (then nothing was paid automatically). */
  required?: boolean;
  summary: string;
  disputed: { criterionId: string; reason: string }[];
  redFlags: string[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface PaymentState {
  mode: 'sandbox' | 'simulated';
  orderId?: string;
  authorizationId?: string;
  authorizationStatus?: string;
  authorizedAt?: string;
  /** PayPal honors an authorization for 3 days and lets you capture it for 29. */
  honorExpiresAt?: string;
  expiresAt?: string;
  captureId?: string;
  capturedAt?: string;
  voidedAt?: string;
  payoutBatchId?: string;
  payoutStatus?: string;
  payerEmail?: string;
  /** Set when less than the full amount was captured (a settlement); PayPal released the rest of the hold. */
  capturedAmount?: string;
  /** The hold outlived PayPal's 3-day honor period and was reauthorized (once); the old authorization id. */
  reauthorizedAt?: string;
  previousAuthorizationId?: string;
  /** Last failed reauthorization attempt, so a poll doesn't retry it every few seconds. */
  reauthTriedAt?: string;
  /** What PayPal authorized, when the deal's amount was later lowered by agreement (the capture then names its amount). */
  authorizedAmount?: string;
  /** Money PayPal returned to the client from the capture after the deal was paid, oldest first. */
  refunds?: { id: string; amount: string; status: string; at: string }[];
  /** What the payout sent to the freelancer, after any amount kept back for an earlier refund. */
  payoutAmount?: string;
  /** Kept back from this payout to cover a refund on an earlier deal with the same freelancer. */
  payoutDeduction?: string;
  /** Refunded to the client after the freelancer had been paid: what they owe back from future payouts. */
  refundOwed?: string;
  /** PayPal cancelled the unclaimed payout so a refund could come back from it. */
  payoutCancelledAt?: string;
  /** PayPal's fee on the capture and what was left; the payout is paid from what was left. */
  paypalFee?: string;
  capturedNet?: string;
  /** The record's fingerprint sent to PayPal in the capture note (the timeline's last hash then). */
  anchoredRecord?: string;
}

/** The terms a deal is judged and paid by, and an offer from one side to change them. */
export interface Terms {
  criteria: string[];
  amount: string;
  dueDays?: number;
}
export interface TermsChange {
  by: 'client' | 'freelancer';
  to: Terms;
  note: string;
  at: string;
}

/** The client's report of a problem after the payment, and what the freelancer did about it. */
export interface Complaint {
  text: string;
  /** What the client asks back, at most what was captured and not refunded yet. */
  amount: string;
  at: string;
  status: 'open' | 'refunded' | 'declined' | 'withdrawn';
  /** The freelancer's answer when declining, or a note with the refund. */
  reply?: string;
  closedAt?: string;
}

/** An open offer to close the milestone for part of the money. The other party accepts or declines. */
/** A PayPal dispute on the deal's capture, and whether the deal's evidence went to PayPal. */
export interface Dispute {
  id: string;
  reason: string;
  status: string;
  amount?: string;
  openedAt: string;
  updatedAt: string;
  /** When PayPal took the deal's evidence (notes plus the record as a PDF). */
  evidenceSentAt?: string;
  /** Why it could not be sent (yet), in words. */
  evidenceNote?: string;
}

export interface SettlementOffer {
  by: 'client' | 'freelancer';
  amount: string;
  note: string;
  at: string;
}

export interface MilestoneAccess {
  clientKey: string;
  freelancerKey: string;
}

export type Role = 'client' | 'freelancer' | 'viewer';

export interface ProjectStage {
  id: string;
  title: string;
  /** 1-based position, and every stage's milestone id in order. */
  stage: number;
  stageIds: string[];
  /** How many days this stage is planned to take, from the project plan (the timeline draws it). */
  days?: number;
}

export interface JobBoardState {
  postedAt: string;
  /** Who took the job and when. They got a fresh freelancer key; a claim with no delivery lapses. */
  claimedAt?: string;
  claimedBy?: string;
}

export interface TimelineEvent {
  at: string;
  type: string;
  text: string;
  actor: 'client' | 'freelancer' | 'agent' | 'paypal' | 'system';
  /** SHA-256 of this step and the one before it (lib/escrow/chain.ts). */
  hash?: string;
  /** SHA-256 of the deal's terms when this step was sealed (criteria, amount, files, payee). */
  state?: string;
}

export interface Milestone {
  id: string;
  title: string;
  description: string;
  criteria: Criterion[];
  amount: string; // decimal string, PayPal style
  currency: string;
  client: Party;
  freelancer: Party;
  /** Minimum per-criterion confidence the agent needs before it may release money. */
  releaseThreshold: number;
  /** Hours the client has to object after the AI verifies the work, before the money moves. 0 or missing: right away. */
  objectionHours?: number;
  /** When a verified milestone's payment goes out, unless the client objects first. */
  releaseAt?: string;
  /** The deadline: days after PayPal holds the money, and the date that gives once it does. */
  dueDays?: number;
  dueAt?: string;
  settlement?: SettlementOffer;
  /** After the payment: the client reported a problem (the latest one; earlier ones are in the timeline). */
  complaint?: Complaint;
  /** An open offer to change the criteria, lower the amount or move the deadline; the other side accepts. */
  termsChange?: TermsChange;
  /** When the terms were last changed by agreement (a review before that judged the old ones). */
  termsChangedAt?: string;
  /** Every PayPal REST call made for this milestone (newest last, capped). */
  paypalCalls?: { at: string; method: string; path: string; status: number; ms: number; requestId?: string; debugId?: string }[];
  /** PayPal webhook events already applied, so a redelivery is a no-op. */
  webhookEvents?: string[];
  /** Created by "Try it in 60 seconds": a simulated hold and a prepared delivery whose review is a replay. */
  demo?: { scenario: string; /** When it was opened, for a demo whose history is dated earlier (the project). */ openedAt?: string };
  /** Posted on the open job board: once funded, any AI agent (or person) can take it. */
  board?: JobBoardState;
  /** The AI agent that wrote and posted the job for the client (through MCP). The client still approves the payment. */
  postedBy?: string;
  /** One stage of a project: stages are funded and paid one by one, in order, with the same two links. */
  project?: ProjectStage;
  /** PayPal disputes the buyer opened on this deal's capture, as PayPal's webhooks reported them. */
  disputes?: Dispute[];
  /** Computed when the deal is sent out, never stored: the timeline's fingerprint and whether it checks out. */
  seal?: { head: string; events: number; intact: boolean; brokenAt?: number; termsChanged?: boolean };
  status: MilestoneStatus;
  payment: PaymentState;
  submissions: Submission[];
  reviews: Review[];
  timeline: TimelineEvent[];
  /** Secret keys for the two parties' links. Server-side only; missing on very old records. */
  access?: MilestoneAccess;
  createdAt: string;
  updatedAt: string;
}
