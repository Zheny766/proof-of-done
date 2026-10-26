// A milestone = one piece of work. Its payment is authorized on PayPal up front and captured once
// the work is verified.

export type MilestoneStatus =
  | 'awaiting_funding' // created, client has not authorized payment yet
  | 'funded' // PayPal authorization in place, waiting for the freelancer to deliver
  | 'reviewing' // a submission is being checked by the AI reviewer
  | 'changes_requested' // reviewer found unmet criteria; freelancer can resubmit
  | 'escalated' // reviewer was not confident; the client decides
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
  engine: 'claude' | 'simulated';
  model?: string;
  findings: CriterionFinding[];
  decision?: ReviewDecision;
  summary?: string;
  feedback?: string;
  log: AgentLogEntry[];
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
}

export interface MilestoneAccess {
  clientKey: string;
  freelancerKey: string;
}

export type Role = 'client' | 'freelancer' | 'viewer';

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
