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
}

export interface Audit {
  engine: 'claude' | 'simulated';
  model?: string;
  agreed: boolean;
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
}

/** An open offer to close the milestone for part of the money. The other party accepts or declines. */
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
  settlement?: SettlementOffer;
  /** Every PayPal REST call made for this milestone (newest last, capped). */
  paypalCalls?: { at: string; method: string; path: string; status: number; ms: number; requestId?: string; debugId?: string }[];
  /** PayPal webhook events already applied, so a redelivery is a no-op. */
  webhookEvents?: string[];
  /** Created by "Try it in 60 seconds": a simulated hold and a prepared delivery whose review is a replay. */
  demo?: { scenario: string };
  /** Posted on the open job board: once funded, any AI agent (or person) can take it. */
  board?: JobBoardState;
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
