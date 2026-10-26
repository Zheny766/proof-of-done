// AG Studio's data sources for the escrow dashboard: a table per row type in lib/escrow/analytics.ts,
// the relationships between them, a shared calendar and a few calculated measures.

import type {
  AgDataSourcesDefinition,
  AgExpressionFieldDefinition,
  AgFieldDefinition,
  AgFormat,
  AgRelationDefinition,
} from 'ag-studio';
import { createFormats } from 'ag-studio';
import type { EscrowDashboardData } from '@/lib/escrow/analytics';

const CALENDAR_ID = 'calendar';

// [id, name, format, hide?]
type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];

const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));

// Foreign key 'table.field' -> primary key 'table.field'.
const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split('.');
  const [targetTable, targetField] = target.split('.');
  return {
    id,
    source: { tableId: sourceTable, fieldId: sourceField },
    target: { tableId: targetTable, fieldId: targetField },
    type: 'many-to-one',
  };
};

const onCalendar = (tableId: string, fieldId: string, truncate?: 'day'): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR_ID },
  ...(truncate && { truncate }),
});

const sumOf = (id: string) => ({ id, aggregation: 'sum' as const });

const ratio = (id: string, name: string, description: string, numerator: string, denominator: string): AgExpressionFieldDefinition => ({
  id,
  name,
  description,
  format: 'percentageFormat',
  isMeasure: true,
  expression: { operator: 'divide', inputs: [sumOf(numerator), sumOf(denominator)] },
});

/** Whether there is anything to report on. Without it, Studio would only show empty widgets. */
export const hasData = (data: EscrowDashboardData) => data.milestones.length > 0;

export function buildStudioData(data: EscrowDashboardData): AgDataSourcesDefinition {
  const dates = [...data.milestones.map((r) => r.createdDate), ...data.reviews.map((r) => r.startedDate)].filter(Boolean).sort();
  const today = data.asOf.slice(0, 10);

  return {
    description:
      'Proof of Done escrow data. Each milestone is a freelance job whose payment was authorized on PayPal (a hold) and is captured only ' +
      'after an AI reviewer verifies the acceptance criteria, or the client approves. Reviews are AI verification runs; findings are the ' +
      'per-criterion verdicts with a 0-1 confidence. Money is in USD. Rows marked as demo use simulated payments.',
    sources: [
      {
        id: 'milestones',
        description: 'One row per milestone (escrowed job). On hold = authorized but not captured yet. Hours to paid = from PayPal authorization to capture.',
        data: data.milestones,
        fields: fields([
          ['id', 'Milestone ID', 'textFormat', true],
          ['title', 'Milestone', 'textFormat'],
          ['category', 'Category', 'textFormat'],
          ['status', 'Status', 'textFormat'],
          ['stage', 'Stage', 'textFormat'],
          ['client', 'Client', 'textFormat'],
          ['freelancer', 'Freelancer', 'textFormat'],
          ['currency', 'Currency', 'textFormat'],
          ['amount', 'Amount', 'currencyFormat'],
          ['onHold', 'On Hold', 'currencyFormat'],
          ['released', 'Released', 'currencyFormat'],
          ['voided', 'Voided', 'currencyFormat'],
          ['createdAt', 'Created At', 'dateTimeFormat'],
          ['createdDate', 'Created', 'dateFormat'],
          ['fundedAt', 'Funded At', 'dateTimeFormat'],
          ['releasedAt', 'Released At', 'dateTimeFormat'],
          ['hoursToPaid', 'Hours to Paid', 'integerFormat'],
          ['criteriaCount', 'Criteria', 'integerFormat'],
          ['criteriaMet', 'Criteria Met', 'integerFormat'],
          ['submissions', 'Submissions', 'integerFormat'],
          ['reviews', 'Reviews', 'integerFormat'],
          ['autoReleased', 'Auto-released by AI', 'booleanFormat'],
          ['isReleased', 'Is Released', 'integerFormat', true],
          ['isAutoReleased', 'Is Auto-released', 'integerFormat', true],
          ['lowestConfidence', 'Lowest AI Confidence', 'percentageFormat'],
          ['paymentMode', 'Payment Mode', 'textFormat'],
          ['isDemo', 'Demo Data', 'booleanFormat'],
        ]),
      },
      {
        id: 'reviews',
        name: 'AI Reviews',
        description: 'One row per AI verification run of a submission. Decision is release, request_changes or escalate.',
        data: data.reviews,
        fields: fields([
          ['id', 'Review ID', 'textFormat', true],
          ['milestoneId', 'Milestone ID', 'textFormat', true],
          ['startedAt', 'Review Started', 'dateTimeFormat'],
          ['startedDate', 'Review Date', 'dateFormat'],
          ['engine', 'Reviewer', 'textFormat'],
          ['decision', 'Decision', 'textFormat'],
          ['durationSec', 'Review Seconds', 'integerFormat'],
          ['findings', 'Findings', 'integerFormat'],
          ['metCount', 'Met', 'integerFormat'],
          ['notMetCount', 'Not Met', 'integerFormat'],
          ['unclearCount', 'Unclear', 'integerFormat'],
          ['avgConfidence', 'Avg Confidence', 'percentageFormat'],
          ['inputTokens', 'Input Tokens', 'integerFormat'],
          ['outputTokens', 'Output Tokens', 'integerFormat'],
        ]),
      },
      {
        id: 'findings',
        name: 'Criterion Findings',
        description: 'One row per acceptance-criterion verdict in a review, with the model confidence and the evidence it cited.',
        data: data.findings,
        fields: fields([
          ['id', 'Finding ID', 'textFormat', true],
          ['milestoneId', 'Milestone ID', 'textFormat', true],
          ['reviewId', 'Review ID', 'textFormat', true],
          ['criterion', 'Criterion', 'textFormat'],
          ['status', 'Verdict', 'textFormat'],
          ['confidence', 'Confidence', 'percentageFormat'],
          ['aboveThreshold', 'Passes Threshold', 'booleanFormat'],
          ['evidence', 'Evidence', 'textFormat'],
        ]),
      },
      {
        id: 'events',
        name: 'Timeline Events',
        description: 'Audit trail: every action by the client, freelancer, AI agent, PayPal or the system.',
        data: data.events,
        fields: fields([
          ['id', 'Event ID', 'textFormat', true],
          ['milestoneId', 'Milestone ID', 'textFormat', true],
          ['at', 'Event Time', 'dateTimeFormat'],
          ['date', 'Event Date', 'dateFormat'],
          ['actor', 'Actor', 'textFormat'],
          ['type', 'Event', 'textFormat'],
          ['text', 'Description', 'textFormat'],
        ]),
      },
    ],
    relationships: [
      manyToOne('review-milestone', 'reviews.milestoneId', 'milestones.id'),
      manyToOne('finding-milestone', 'findings.milestoneId', 'milestones.id'),
      manyToOne('finding-review', 'findings.reviewId', 'reviews.id'),
      manyToOne('event-milestone', 'events.milestoneId', 'milestones.id'),
      onCalendar('milestones', 'createdDate'),
      onCalendar('reviews', 'startedDate'),
      onCalendar('events', 'date'),
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: 'Calendar',
        range: {
          from: { type: 'date', value: dates[0] ?? today },
          to: { type: 'date', value: dates.at(-1) ?? today },
        },
        fragments: ['year', 'quarter', 'month', 'week', 'day', 'dayOfWeek'],
      },
    ],
    // Money in USD: show a dollar sign and whole dollars (the default currency format has no symbol).
    formats: createFormats({ overrides: { currencyFormat: { formatOptions: { format: '$#,##0' } } } }),
    expressions: [
      ratio('releaseRate', 'Release Rate', 'Released value / total milestone value.', 'milestones.released', 'milestones.amount'),
      ratio('autoReleaseRate', 'AI Auto-release Rate', 'Share of paid milestones where the AI released the money without the client stepping in.', 'milestones.isAutoReleased', 'milestones.isReleased'),
      ratio('holdShare', 'Share On Hold', 'Value currently held on PayPal / total milestone value.', 'milestones.onHold', 'milestones.amount'),
    ],
  };
}
