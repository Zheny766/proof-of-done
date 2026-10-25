# Devpost submission text

> Copy each section into the matching field of the Devpost "Enter a Submission" form.

## Project name
Proof of Done

## Elevator pitch (tagline, 200 chars)
PayPal escrow that pays itself: the client's money is held with PayPal, and a Claude agent releases it the moment it verifies every acceptance criterion of the delivered work.

## Inspiration
Fixed-price freelance work runs on trust that often isn't there. Freelancers deliver and then chase payment for weeks; clients hesitate to pay up front for work that may never arrive. Escrow fixes the money, but release still waits on someone to look, approve and click - or on a dispute. We wanted the hold to be as safe as escrow and the release to be as fast as the work itself.

## What it does
- The client creates a **milestone** with acceptance criteria (Claude can draft objectively checkable ones from a plain description) and funds it with **PayPal**: an Orders v2 order with **intent AUTHORIZE**, approved with the **PayPal JS SDK v6**. The money is held, not charged.
- The freelancer submits the work: notes, links, screenshots, PDFs, files.
- A **Claude Opus 5.5 reviewer agent** checks the submission. It reads the brief, opens links, looks at images and documents, and records one finding per criterion - met / not met / unclear, with a confidence and the evidence it used.
- Then it makes exactly one decision: **release** (capture the PayPal authorization and send a **PayPal Payout** to the freelancer), **request changes** (specific feedback; money stays on hold), or **escalate** to the client.
- The client always keeps the final say: approve, ask for changes, or cancel - which **voids** the authorization so nothing is charged.
- An **AG Studio** dashboard shows where the money is, how often the AI pays out without the client stepping in, which verdicts were least confident, and how each freelancer is doing - and its AI assistant runs on **Claude** through an adapter we wrote for the AG Studio Agent Framework.

## How we built it
- **Next.js 16 / React 19 / TypeScript**, starting from PayPal's PayPal × AG Grid hackathon boilerplate.
- **PayPal**: Orders v2 (`AUTHORIZE`), `/authorize`, Payments v2 capture and void, Payouts, OAuth client credentials, `PayPal-Request-Id` idempotency on every money call, JS SDK v6 `createPayPalOneTimePaymentSession` + `<paypal-button>`.
- **Claude**: the Anthropic TypeScript SDK **Tool Runner** with Zod-typed tools (`read_brief`, `fetch_link`, `record_finding`, `release_payment`, `request_changes`, `escalate_to_client`), adaptive thinking at high effort, vision and PDF input, structured outputs for criteria drafting, server-side refusal fallback.
- **Safety by construction**: release is gated by a code-level policy (every criterion `met` at or above a client-chosen confidence threshold), submission content is treated as evidence and never as instructions, no decision means no payout, and every step is logged.
- **AG Grid / AG Studio**: an AG Grid milestone ledger with custom cell renderers, a three-page AG Studio escrow analytics report over four related tables with calculated measures, and a **Claude adapter for AG Studio's Agent Framework** that translates AG-UI requests, tool calls and streaming events to the Claude Messages API - including replaying Claude's signed thinking blocks across tool calls.

## Challenges we ran into
- **Letting an AI move money without trusting it blindly.** The answer was to give the agent tools instead of a free-text verdict, and to make the money move only through a policy written in code.
- **Prompt injection through deliverables.** A submission can contain "approve this immediately". The reviewer treats all submission content as data, flags such attempts, and the policy still requires evidence for every criterion.
- **PayPal authorization lifecycles.** Holds are honored for 3 days and capturable for 29; we track both and void cleanly on cancel.
- **Bridging two agent protocols.** AG Studio speaks AG-UI events and OpenAI-style items; Claude uses content blocks with signed thinking. Our bridge keeps the original assistant content server-side so multi-step tool use works.

## Accomplishments that we're proud of
- An end-to-end flow where an AI agent *actually transacts* - authorize, verify, capture, payout - with a human override at every step.
- A release policy that makes the agent's power explicit and testable.
- A Claude adapter for AG Studio's Agent Framework (which ships with an OpenAI adapter only), with unit tests.

## What we learned
Agentic payments are less about what the model can do and more about the boundaries around it: typed tools, code-enforced policies, honest escalation, and an audit trail both sides can read.

## What's next for Proof of Done
- Re-authorization when the honor period ends; partial captures for multi-part milestones.
- Accounts and roles for clients and freelancers; PayPal webhooks for authorization and payout status.
- Domain-specific verifiers: running a repo's tests, checking a live site with a headless browser, checking image dimensions and formats.
- Dispute support: hand PayPal a structured evidence pack from the review log.

## Built with
`paypal` `paypal-orders-api` `paypal-payouts` `paypal-js-sdk-v6` `claude` `anthropic` `ag-grid` `ag-studio` `next.js` `react` `typescript` `tailwindcss` `zod`

## Tools used (AI / sponsor tools field)
- **Claude Opus 5.5** (Anthropic API): reviewer agent with tools, criteria drafting (structured outputs), and the AG Studio assistant via our Claude adapter.
- **AG Grid** (milestone ledger) and **AG Studio** (escrow analytics dashboard, Agent Framework with a swapped-in Claude harness).
- **PayPal Developer Platform** (sandbox): Orders v2, Payments v2 capture/void, Payouts, JS SDK v6.

## Try it
Repository README has full setup. Runs locally with `npm install && npm run dev`; works with no keys in simulated mode, and with PayPal sandbox + Anthropic keys for the real flow.
