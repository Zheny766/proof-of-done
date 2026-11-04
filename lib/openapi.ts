import 'server-only';
// The HTTP API as an OpenAPI 3.1 document, served at /openapi.json. Request bodies are generated from
// the same zod schemas the routes validate with, so the document can't promise what the server
// refuses; test/openapi.test.ts checks that every path in it is a real route and the other way round.

import { z } from 'zod';
import { AfterPaymentInput, ClaimJobInput, CreateMilestoneInput, CreateProjectInput, DecisionInput, SettlementInput, TermsInput } from './escrow/service.ts';

const schema = (s: z.ZodType) => {
  const out = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete out.$schema;
  return out;
};
const json = (s: Record<string, unknown>) => ({ required: true, content: { 'application/json': { schema: s } } });
const ok = (description: string, ref = '#/components/schemas/DealAnswer') => ({ description, content: { 'application/json': { schema: { $ref: ref } } } });
const errors = {
  '400': { description: 'The input is not valid; `error` says which field and what to fix.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '403': { description: 'This key may not do that (only the client, or only the freelancer).', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '404': { description: 'No such deal.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '409': { description: 'Not possible in the deal’s current state; `error` says why.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '429': { description: 'Too many requests from this address; try again in a minute.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
};
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^ms_[0-9a-f]{12}$' }, description: 'The deal id (`ms_…`).' };
const party = [{ dealKey: [] }];
const action = (summary: string, description: string, body: z.ZodType | Record<string, unknown>, tag = 'Deals') => ({
  post: {
    tags: [tag],
    summary,
    description,
    security: party,
    parameters: [id],
    requestBody: json(body instanceof z.ZodType ? schema(body) : body),
    responses: { '200': ok('The deal after the change.'), ...errors },
  },
});

export function openApiDocument(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Proof of Done API',
      version: '1.0.0',
      summary: 'PayPal escrow that pays out when two AI models verify the delivered work.',
      description:
        'The client funds a deal with a PayPal authorization (held, not charged). The freelancer, a person or an AI agent, delivers; Claude checks the work against every acceptance criterion, a second model double-checks, a rule in code decides, and PayPal captures and pays out. Each party acts with its own key, sent as the `x-milestone-key` header. AI agents can also use the MCP server at `/api/mcp`.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: origin }],
    tags: [
      { name: 'Deals', description: 'Create, fund, deliver, decide; every money step is a PayPal call.' },
      { name: 'Jobs', description: 'The open job board: deals already funded, waiting for someone (or some agent) to take them.' },
      { name: 'Agents', description: 'For AI agents: MCP and drafting checkable criteria.' },
      { name: 'Demo', description: 'Ready-made deals for trying it without PayPal or Claude keys.' },
      { name: 'Operations', description: 'Readiness and PayPal webhooks.' },
    ],
    components: {
      securitySchemes: { dealKey: { type: 'apiKey', in: 'header', name: 'x-milestone-key', description: 'The client’s or the freelancer’s key for this deal, from when it was created or claimed. Without it you see the deal as an outsider.' } },
      schemas: {
        Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
        Deal: {
          type: 'object',
          description: 'A deal (milestone). Fields an outsider may not see are emptied for them.',
          required: ['id', 'title', 'status', 'amount', 'currency', 'criteria', 'payment', 'timeline'],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            status: { enum: ['awaiting_funding', 'funded', 'reviewing', 'changes_requested', 'escalated', 'verified', 'released', 'cancelled'] },
            amount: { type: 'string', description: 'Decimal, PayPal style: "120.00".' },
            currency: { const: 'USD' },
            criteria: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } } } },
            payment: { type: 'object', description: 'PayPal ids and states: order, authorization, capture, payout, refunds.' },
            reviews: { type: 'array', items: { type: 'object', description: 'Each AI review: findings per criterion with confidence and evidence, the decision, the second opinion.' } },
            timeline: { type: 'array', items: { type: 'object', properties: { at: { type: 'string', format: 'date-time' }, actor: { type: 'string' }, type: { type: 'string' }, text: { type: 'string' }, hash: { type: 'string', description: 'SHA-256 of this step and the one before.' } } } },
            seal: { type: 'object', description: 'The timeline’s fingerprint and whether every step still matches it.', properties: { head: { type: 'string' }, events: { type: 'integer' }, intact: { type: 'boolean' } } },
          },
        },
        DealAnswer: { type: 'object', required: ['milestone'], properties: { milestone: { $ref: '#/components/schemas/Deal' } } },
        Created: {
          type: 'object',
          properties: {
            milestone: { $ref: '#/components/schemas/Deal' },
            clientKey: { type: 'string', description: 'Keep it: it is the only way to act as the client.' },
            freelancerKey: { type: 'string', description: 'Send it to the freelancer. Absent for a job on the open board.' },
            criteriaHints: { type: 'array', items: { type: 'string' }, description: 'Criteria the reviewer may not be able to check, with what to write instead.' },
          },
        },
      },
    },
    paths: {
      '/api/escrow/milestones': {
        get: { tags: ['Deals'], summary: 'List deals (as an outsider sees them)', responses: { '200': { description: 'Deals, without private details.' } } },
        post: { tags: ['Deals'], summary: 'Create a deal', description: 'The caller becomes the client. With `postToBoard` it goes on the open job board once funded.', requestBody: json(schema(CreateMilestoneInput)), responses: { '201': ok('The new deal and both keys.', '#/components/schemas/Created'), ...errors } },
      },
      '/api/escrow/projects': {
        post: { tags: ['Deals'], summary: 'Create a project in stages', description: 'Each stage is its own deal, funded when it starts and paid when it passes. The same two keys work for every stage.', requestBody: json(schema(CreateProjectInput)), responses: { '201': { description: 'The stages and both keys.' }, ...errors } },
      },
      '/api/escrow/milestones/{id}': {
        get: { tags: ['Deals'], summary: 'Read a deal', description: 'With a key you see everything your side may; without one, what an outsider may.', security: [{ dealKey: [] }, {}], parameters: [id], responses: { '200': { description: 'The deal, your role, and the project’s stages if it has any.' }, ...errors } },
      },
      '/api/escrow/milestones/{id}/order': {
        post: { tags: ['Deals'], summary: 'Start funding: create the PayPal order', description: 'Orders v2 with `intent: AUTHORIZE`. Returns the order id for the PayPal button. Client only.', security: party, parameters: [id], responses: { '200': { description: '`{ orderId }`' }, ...errors } },
      },
      '/api/escrow/milestones/{id}/authorize': action('Finish funding: place the PayPal hold', 'After the buyer approves in PayPal, authorizes the order: the money is held, not charged. Client only.', { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string' } } }),
      '/api/escrow/milestones/{id}/submit': {
        post: {
          tags: ['Deals'],
          summary: 'Deliver the work',
          description: 'Notes, links and files (up to 8, 15 MB each). Starts the AI review; poll the deal until it is no longer `reviewing`. Freelancer only.',
          security: party,
          parameters: [id],
          requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['notes'], properties: { notes: { type: 'string', maxLength: 10000 }, links: { type: 'string', description: 'One URL per line.' }, payoutEmail: { type: 'string', format: 'email' }, files: { type: 'array', items: { type: 'string', format: 'binary' } } } } } } },
          responses: { '202': { description: 'Delivered; the review is running. `{ milestone, reviewId }`' }, '413': { description: 'Upload too large.' }, ...errors },
        },
      },
      '/api/escrow/milestones/{id}/decision': action('Client decision', 'Pay now, ask for changes, or cancel and void the PayPal hold (nothing is charged).', DecisionInput),
      '/api/escrow/milestones/{id}/settlement': action('Settle for part', 'One side offers part of the amount; when the other accepts, PayPal captures only that part as the final capture and releases the rest.', SettlementInput),
      '/api/escrow/milestones/{id}/terms': action('Change the terms', 'Either side offers new criteria, a lower amount or another deadline; nothing changes until the other side accepts. After the hold the amount can only go down.', TermsInput),
      '/api/escrow/milestones/{id}/complaint': action('After the payment: complain, refund, decline', 'For 30 days the client can report a problem and ask for money back; the freelancer refunds it through PayPal (a refund on the capture) or declines.', AfterPaymentInput),
      '/api/escrow/milestones/{id}/dispute': action('Send dispute evidence to PayPal', 'Answers a buyer’s PayPal dispute with the deal’s record: a note and a PDF (criteria, delivery with file hashes, both models’ findings, PayPal ids). It also goes by itself when PayPal starts taking evidence. Freelancer only.', { type: 'object', required: ['disputeId'], properties: { disputeId: { type: 'string' } } }),
      '/api/escrow/milestones/{id}/sync': {
        post: { tags: ['Deals'], summary: 'Bring a deal up to date with PayPal', description: 'Renews a hold past its 3-day guarantee, refreshes a pending payout, pays out when an objection window has closed. Needs no key.', parameters: [id], responses: { '200': { description: '`{ id, status, changes }`' }, ...errors } },
      },
      '/api/escrow/milestones/{id}/record': {
        get: {
          tags: ['Deals'],
          summary: 'Download the deal’s record',
          description: 'Everything that happened, for a PayPal dispute or an audit: JSON by default (check it offline with `node scripts/verify-record.mjs`), or the PDF PayPal gets with `?format=pdf`. Client or freelancer only.',
          security: party,
          parameters: [id, { name: 'format', in: 'query', schema: { enum: ['json', 'pdf'] } }],
          responses: { '200': { description: 'The record.', content: { 'application/json': {}, 'application/pdf': {} } }, ...errors },
        },
      },
      '/api/jobs': {
        get: { tags: ['Jobs'], summary: 'List open jobs', description: 'Funded jobs nobody has taken yet: the money is already on hold with PayPal.', responses: { '200': { description: '`{ jobs }`' } } },
      },
      '/api/jobs/{id}/claim': {
        post: { tags: ['Jobs'], summary: 'Take a job', description: 'The taker becomes the freelancer and gets their own key and link. A new taker’s first jobs are limited in amount.', parameters: [id], requestBody: json(schema(ClaimJobInput)), responses: { '200': { description: '`{ job, freelancerKey, link, standing }`' }, ...errors } },
      },
      '/api/escrow/criteria': {
        post: { tags: ['Agents'], summary: 'Draft checkable acceptance criteria', description: 'Claude turns a plain description into criteria a reviewer can verify from a delivery.', requestBody: json({ type: 'object', required: ['title'], properties: { title: { type: 'string', minLength: 3, maxLength: 120 }, description: { type: 'string', maxLength: 4000 } } }), responses: { '200': { description: '`{ criteria }`' }, ...errors } },
      },
      '/api/mcp': {
        post: { tags: ['Agents'], summary: 'MCP server (Streamable HTTP)', description: 'Tools for AI agents: find_jobs, claim_job, post_job, get_job, submit_work, change_terms, wait_for_verdict. JSON-RPC 2.0.', responses: { '200': { description: 'JSON-RPC answer.' } } },
      },
      '/api/demo/start': {
        post: { tags: ['Demo'], summary: 'Open a ready-made demo deal', requestBody: json({ type: 'object', required: ['scenario'], properties: { scenario: { enum: ['honest', 'cheater', 'partial', 'code', 'arena', 'project'] } } }), responses: { '200': { description: 'The demo deal and its keys.' }, ...errors } },
      },
      '/api/health': {
        get: { tags: ['Operations'], summary: 'Readiness', description: 'Whether PayPal runs on the sandbox or simulated, whether the live Claude reviewer and webhooks are on, storage, and that every record is sealed. Never a key.', responses: { '200': { description: 'Ready.' }, '503': { description: 'The data can’t be read.' } } },
      },
      '/api/paypal/webhook': {
        post: { tags: ['Operations'], summary: 'PayPal webhooks', description: 'For PayPal only: nothing is applied until PayPal confirms the signature for this server’s webhook id. Captures, voids, payouts and disputes.', responses: { '200': { description: '`{ result }`' }, '401': { description: 'Signature not verified by PayPal.' } } },
      },
    },
  };
}
