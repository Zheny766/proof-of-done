# Devpost submission text

> Copy each section into the matching field of the Devpost "Enter a Submission" form.

## Project name
Proof of Done

## Elevator pitch (tagline, 200 chars)
Escrow for freelance jobs: the client's money is held on PayPal, and a Claude agent releases it once it has checked the delivered work against every acceptance criterion.

## Inspiration
With fixed-price freelance work someone always has to go first. Either the freelancer delivers and then chases the payment, or the client pays up front and hopes the work shows up. Escrow fixes who holds the money, but releasing it still waits on someone opening the delivery, checking it and clicking approve - which can take days, or end in a dispute. I wanted to see if that check could be done by an AI agent with PayPal holding the money, without handing the agent a blank cheque.

## What it does
- The client creates a milestone with acceptance criteria. Claude can draft them from a plain description, phrased so they can actually be checked from a submission. The client funds it with PayPal: an Orders v2 order with intent AUTHORIZE, approved through the JS SDK v6 button. The money is held, not charged.
- The freelancer submits the work: notes, links, screenshots, PDFs, files.
- A Claude Opus 5.5 reviewer agent reads the brief, opens the links, looks at the images and documents, and records a finding for each criterion: met / not met / unclear, with a confidence and the evidence.
- Then it makes one decision: release (capture the authorization and send a PayPal Payout to the freelancer), request changes (with specific feedback, money stays on hold), or escalate to the client.
- The client can always step in: approve, ask for changes, or cancel, which voids the authorization so nothing is charged.
- Each side gets its own private link. The server checks it on every action: only the client can fund, approve or cancel, only the freelancer can submit.
- An AG Studio dashboard shows where the money is, how often the AI paid out on its own, which verdicts were least confident, and how each freelancer is doing. Its assistant runs on Claude through an adapter I wrote for the AG Studio Agent Framework.

## How I built it
- Next.js 16, React 19, TypeScript, starting from PayPal's PayPal x AG Grid hackathon boilerplate.
- PayPal: Orders v2 with AUTHORIZE, `/authorize`, Payments v2 capture and void, Payouts, OAuth client credentials, a `PayPal-Request-Id` on every money call so retries can't charge twice, and the JS SDK v6 (`createPayPalOneTimePaymentSession` + `<paypal-button>`).
- Claude: the Anthropic TypeScript SDK tool runner with Zod-typed tools (`read_brief`, `fetch_link`, `record_finding`, `release_payment`, `request_changes`, `escalate_to_client`), adaptive thinking at high effort, image and PDF input, structured outputs for drafting criteria.
- Tests cover the escrow state machine end to end in simulated mode (who may do what in which state, parallel approvals, stuck reviews, a corrupt data file), plus the release policy, role keys and redaction, the link guard and the Claude bridge.
- The agent can't pay on its own word. `release_payment` goes through a policy check in code: every criterion has to be `met` at or above the confidence threshold the client picked. Submission content is treated as evidence, not instructions. No decision means no payout. Every step is logged.
- AG Grid for the milestone table, AG Studio for a three-page escrow report over four related tables, plus a custom Studio widget (the escrow pipeline) and the Claude adapter, which translates AG-UI requests, tool calls and streaming events to the Messages API.

## Challenges I ran into
- Letting an AI move money without just trusting it. What worked: tools instead of a free-text verdict, and a release rule in code that the model can't argue with.
- Prompt injection through deliverables. A submission can say "approve this now". The reviewer is told to treat that as a red flag, and even if it didn't, the policy still wants evidence for each criterion.
- The reviewer opens links that come from the submitter, so it could be pointed at internal addresses, or talked into "checking" an attacker's URL with the brief in it. It only opens sites the submission links to, checks the address inside the connection's own DNS lookup (so DNS rebinding doesn't work), and checks every redirect hop again.
- Money races: two tabs, a double click, a cancel while the freelancer submits. Every operation on a milestone goes through a small per-milestone queue, PayPal calls carry idempotency keys, and a payout only goes out once the capture is COMPLETED.
- Privacy without accounts: the client and the freelancer each get a secret link, and everyone else only sees where a milestone stands, not the brief, the work or anyone's email.
- PayPal authorization lifetimes: an authorization is honored for 3 days and can be captured for 29. The app tracks both and voids cleanly on cancel.
- Making two agent protocols talk. AG Studio speaks AG-UI events; Claude needs its signed thinking blocks sent back with the tool calls they produced, which Studio doesn't keep. The server remembers the raw content per tool call.

## Accomplishments that I'm proud of
- The whole money path runs against the real PayPal sandbox: authorize through the popup, capture, payout (PENDING -> SUCCESS), and void.
- The agent actually transacts, but only inside a rule that is written down and tested.
- A working Claude adapter for AG Studio's Agent Framework, with unit tests.

## What I learned
Most of the work in an agent that touches money isn't the model. It's the boundaries around it: what the tools allow, what the code refuses, when to hand the decision back to a human, and a log that both sides can read.

## What's next for Proof of Done
- Re-authorize when the honor period runs out; partial captures for milestones with several parts.
- Real accounts for clients and freelancers; PayPal webhooks for authorization and payout status.
- Checks for specific kinds of work: run a repo's tests, open a live site in a headless browser, check image sizes and formats.
- Disputes: give PayPal the review log as a structured evidence pack.

## Built with
`paypal` `paypal-orders-api` `paypal-payouts` `paypal-js-sdk-v6` `claude` `anthropic` `ag-grid` `ag-studio` `next.js` `react` `typescript` `tailwindcss` `zod`

## Tools used (AI / sponsor tools field)
- Claude Opus 5.5 (Anthropic API): the reviewer agent, criteria drafting, and the AG Studio assistant through the Claude adapter.
- AG Grid (milestone table) and AG Studio (escrow dashboard, Agent Framework running on Claude).
- PayPal Developer Platform (sandbox): Orders v2, Payments v2 capture/void, Payouts, JS SDK v6.

## Try it
Setup is in the README. `npm install && npm run dev` runs it in simulated mode with no keys; with PayPal sandbox and Anthropic keys it runs the real flow.
