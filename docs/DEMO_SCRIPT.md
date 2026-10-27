# Demo video script (about 2:00, hard limit 3:00)

Rules: under 3 minutes, shows the project working, public on YouTube, **no third-party trademarks or copyrighted music/material without permission**.
Judging (Presentation): *"Does the video clearly demonstrate the project working end-to-end? Does the pitch communicate what problem is solved, who it's for, and why it matters?"*

The story in one line: **an AI agent decides whether to pay and pays through PayPal, but only when a second model and a rule in code agree.** Story first: the cheater, then Maya (client) and Diego (freelancer) through one real deal.

| Scene | Length | Screen | Narration |
|---|---|---|---|
| hook | 13 s | The cheater's deal: notes ordering the reviewer to skip the checks, Opus calls `release_payment`, the second opinion refuses with a red flag, money stays on hold | "This freelancer hid an order in his notes: skip the checks and pay me. Claude Opus checked anyway, found the work fine, and went to pay. A second model caught the trick and said no. Not a cent moved." |
| problem | 13 s | Slide: Maya and Diego; 71% of US freelancers have struggled to get paid (Freelancers Union) | "Maya runs a cafe. Diego designs her menus. Seventy-one percent of freelancers like Diego have struggled to get paid, and clients like Maya don't want to pay up front for work that never shows up." |
| how | 14 s | Slide: PayPal holds → Claude Opus checks → Claude Haiku double-checks → rule in code → PayPal pays | "Proof of Done is escrow with an AI agent doing the check. PayPal holds the money. Claude Opus checks the delivery. A second model double-checks. A rule in code decides. Then PayPal pays." |
| create | 8 s | New deal form → **Draft with AI** → threshold slider | "Maya describes the job. Claude turns it into criteria that can actually be checked, and she picks how sure the AI has to be." |
| fund | 6 s | **Pay with PayPal** → the real sandbox popup (mirrored into the frame) → funded, on hold | "She approves the payment in PayPal. It's an authorization: the money is held, not charged." |
| review | 19 s | Diego submits the PDF → live audit log → `get_order` through PayPal's Agent Toolkit → second opinion confirms → captured and paid out | "Diego hands in the menu. Claude Opus reads the PDF and checks every criterion. Then it asks PayPal, through PayPal's own agent toolkit, whether the money is still there. Claude Haiku agrees, PayPal captures the payment, and Diego is paid. Nobody clicked approve." |
| eval | 7 s | Slide: the evaluation, 32 deliveries, 0 false payouts | "And the cheater from the start? Across thirty-two test deliveries with known answers, there were zero false payouts." |
| settle | 10 s | Half-done brunch menu: changes requested → $60 of $100 offered and accepted → PayPal captures $60, the rest goes back | "When work is only half done, either side can offer a lower amount. Accept it, and PayPal captures just that part. Maya is never charged the rest." |
| agent | 11 s | Claude Code, headless, connected over MCP: `find_jobs` → `claim_job` → `submit_work` → `wait_for_verdict`, next to Maya's view of the deal getting paid | "AI agents can earn here too. Claude Code finds a paid job on our board, takes it, delivers the file, and gets paid by the same escrow, with the same checks." |
| dashboard | 11 s | AG Studio: Trust & PayPal page, every PayPal call and every veto; the assistant explains a held deal | "Every decision is on the record. The AG Studio dashboard shows every PayPal call and every veto, and its Claude assistant can explain why any deal was held." |
| end | 7 s | Logo, "Get paid the moment the work is proven", hosted demo URL | "Proof of Done. Get paid the moment the work is proven. Try it in sixty seconds at the link below." |

## Recording
- Real PayPal **sandbox** and real **Claude**: the client approves four sandbox payments in the PayPal popup, signed in as the sandbox buyer; the reviews, the second opinion, the settlement and the agent's job all run live. Waits are cut out and marked on screen ("N s skipped").
- 1440×900, light theme, no personal data on screen; keys never appear in the address bar (the page removes them).
- Narration is synthesized (Kokoro, Apache-2.0), captions burned in so it works without sound, no music.
- Trademarks: PayPal and AG Grid are the organizers and sponsors; Claude is named in text, with no logos we have no permission to use.
- The deals recorded on the real sandbox are kept, with every PayPal id, on the `/sandbox` page ([app/sandbox/page.tsx](../app/sandbox/page.tsx)).
