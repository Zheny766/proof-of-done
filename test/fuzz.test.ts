// Random sequences of actions against the escrow service (simulated PayPal and reviewer): funding,
// delivering, deciding, settling, changing the terms, complaining, refunding, taking board jobs,
// time passing, by the right side, the wrong side or nobody. After every step the money and state
// rules must hold. A refusal (EscrowError, invalid input) is fine; anything else is a bug.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZodError } from 'zod';
import type { Milestone } from '../lib/escrow/types.ts';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-fuzz-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'POD_SEED_BOARD']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const payments = await import('../lib/escrow/payments.ts');
const { checkSeal } = await import('../lib/escrow/chain.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const STATES = ['awaiting_funding', 'funded', 'reviewing', 'changes_requested', 'escalated', 'verified', 'released', 'cancelled'];
const HELD = ['funded', 'reviewing', 'changes_requested', 'escalated', 'verified', 'released'];
const TERMS = ['awaiting_funding', 'funded', 'changes_requested', 'escalated'];

/** Every rule that must hold after any step; returns what broke. */
function broken(m: Milestone): string[] {
  const p = m.payment;
  const count = (type: string) => m.timeline.filter((e) => e.type === type).length;
  return [
    !STATES.includes(m.status) && `unknown status ${m.status}`,
    m.status === 'released' && !p.captureId && 'paid without a capture',
    m.status === 'cancelled' && p.captureId && 'cancelled but captured',
    count('captured') > 1 && 'captured twice',
    count('payout') > 1 && 'paid out twice',
    p.captureId && Number(p.capturedAmount ?? m.amount) > Number(p.authorizedAmount ?? m.amount) + 1e-9 && 'captured more than PayPal held',
    p.authorizedAmount && Number(m.amount) > Number(p.authorizedAmount) + 1e-9 && 'amount above the PayPal hold',
    payments.refundable(m) < -1e-9 && 'refunded more than captured',
    m.settlement && !['changes_requested', 'escalated'].includes(m.status) && `settlement offer left open while ${m.status}`,
    m.termsChange && !TERMS.includes(m.status) && `terms offer left open while ${m.status}`,
    m.complaint?.status === 'open' && m.status !== 'released' && `open complaint while ${m.status}`,
    m.releaseAt && m.status !== 'verified' && `release time left set while ${m.status}`,
    HELD.includes(m.status) && !p.authorizationId && `${m.status} without a PayPal authorization`,
    m.status === 'reviewing' && m.reviews.at(-1)?.finishedAt && 'still reviewing after the review finished',
    m.timeline.some((e, i) => i > 0 && e.at < m.timeline[i - 1].at) && 'timeline out of order',
    !checkSeal(m).intact && 'record chain broken',
  ].filter((x): x is string => typeof x === 'string');
}

test('random action sequences never break the money or state rules', async () => {
  let seed = 20261104;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const problems = new Map<string, number>();
  const note = (what: string) => problems.set(what, (problems.get(what) ?? 0) + 1);
  const attempt = async (label: string, fn: () => unknown) => {
    try {
      await fn();
    } catch (e) {
      const err = e as Error;
      if (err.constructor?.name !== 'EscrowError' && !(e instanceof ZodError)) note(`${label} threw ${err.constructor?.name}: ${err.message.slice(0, 100)}`);
    }
  };
  const base = { title: 'Fuzz deal', criteria: ['A PDF is delivered', 'At least 10 items listed'], clientName: 'C', clientEmail: 'c@example.com' };

  for (let run = 0; run < 120; run++) {
    const kind = pick(['direct', 'board', 'objection', 'project']);
    let ids: string[];
    let ck: string;
    let fk: string;
    if (kind === 'project') {
      const stages = service.createProject({ ...base, freelancerName: 'F', freelancerEmail: 'f@example.com', stages: [{ title: 'One', amount: 30, criteria: ['A PDF'] }, { title: 'Two', amount: 40, criteria: ['A PDF'] }] });
      ids = stages.map((m) => m.id);
      ({ clientKey: ck, freelancerKey: fk } = stages[0].access!);
    } else {
      const m = service.createMilestone({ ...base, amount: pick([5, 50, 100, 250.5]), ...(kind === 'board' ? { postToBoard: true } : { freelancerName: 'F', freelancerEmail: `f${run}@example.com` }), ...(kind === 'objection' && { objectionHours: 1 }) });
      ids = [m.id];
      ({ clientKey: ck, freelancerKey: fk } = m.access!);
    }
    for (let step = 0; step < 14; step++) {
      const id = pick(ids);
      const action = pick(['fund', 'fund', 'submit', 'submit', 'submit', 'approve', 'changes', 'cancel', 'settle', 'settleAccept', 'settleDecline', 'terms', 'terms', 'termsAccept', 'termsAccept', 'termsDecline', 'complain', 'refund', 'refuse', 'withdraw', 'claim', 'time']);
      // Mostly the side that may do it, sometimes the other side or nobody.
      const own = ['submit', 'refund', 'refuse'].includes(action) ? fk : /^(settle|terms)/.test(action) ? pick([ck, fk]) : ck;
      const key = rnd() < 0.8 ? own : pick([ck, fk, null, 'bogus']);
      const label = `${kind}:${action}`;
      switch (action) {
        case 'fund':
          await attempt(label, async () => {
            const { orderId } = await service.beginFunding(id, key);
            await service.confirmFunding(id, orderId, key);
          });
          break;
        case 'submit':
          await attempt(label, async () => {
            const notes = pick(['A PDF is delivered: menu.pdf. At least 10 items listed: 12 items.', 'here', 'menu attached, 12 items, PDF delivered']);
            const files = rnd() < 0.5 ? [{ name: 'menu.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4 fuzz') }] : [];
            const { reviewId } = await service.submitWork(id, { notes, links: [], files }, key);
            if (rnd() < 0.85) await service.runReview(id, reviewId);
          });
          break;
        case 'approve':
        case 'changes':
        case 'cancel':
          await attempt(label, () => service.clientDecision(id, action === 'changes' ? 'request_changes' : action, '', key));
          break;
        case 'settle':
          await attempt(label, () => service.settle(id, { action: 'propose', amount: pick([0.5, 1, 20, 49.99, 100, 1000]) }, key));
          break;
        case 'settleAccept':
        case 'settleDecline':
          await attempt(label, () => service.settle(id, { action: action === 'settleAccept' ? 'accept' : 'decline' }, key));
          break;
        case 'terms':
          await attempt(label, () => service.changeTerms(id, { action: 'propose', criteria: pick([['A PDF is delivered'], ['A PDF is delivered', 'At least 10 items listed', 'Prices in USD']]), amount: pick([1, 4.5, 20, 99.99, 250.5, 400]), ...(rnd() < 0.5 && { dueDays: pick([1, 7, 25]) }) }, key));
          break;
        case 'termsAccept':
        case 'termsDecline':
          await attempt(label, () => service.changeTerms(id, { action: action === 'termsAccept' ? 'accept' : 'decline' }, key));
          break;
        case 'complain':
          await attempt(label, () => service.afterPayment(id, { action: 'complain', text: 'wrong', ...(rnd() < 0.5 && { amount: pick([0.01, 3, 50, 999]) }) }, key));
          break;
        case 'refund':
          await attempt(label, () => service.afterPayment(id, { action: 'refund', ...(rnd() < 0.5 && { amount: pick([0.01, 2, 60, 999]) }) }, key));
          break;
        case 'refuse':
        case 'withdraw':
          await attempt(label, () => service.afterPayment(id, { action: action === 'refuse' ? 'decline' : 'withdraw' }, key));
          break;
        case 'claim':
          await attempt(label, async () => {
            fk = (await service.claimJob(id, { name: 'Agent', payoutEmail: `agent${run}@example.com` })).freelancerKey;
          });
          break;
        case 'time':
          // The objection window closes, a claim lapses, the honor period passes; then the deal is read.
          store.updateMilestone(id, (x) => {
            if (x.releaseAt) x.releaseAt = new Date(Date.now() - 1000).toISOString();
            if (x.board?.claimedAt) x.board.claimedAt = new Date(Date.now() - 25 * 3600_000).toISOString();
            if (x.payment.honorExpiresAt) x.payment.honorExpiresAt = new Date(Date.now() - 1000).toISOString();
            if (x.dueAt) x.dueAt = new Date(Date.now() - 1000).toISOString();
          });
          await attempt(label, () => service.readMilestone(id));
          break;
      }
      for (const what of broken(store.getMilestone(id)!)) note(`${what} (after ${label})`);
    }
  }
  const statuses = new Set<string>(store.listMilestones().map((m) => m.status));
  assert.ok(['released', 'cancelled', 'funded', 'changes_requested'].every((s) => statuses.has(s)), `the runs reached the main states: ${[...statuses]}`);
  assert.deepEqual([...problems].map(([what, n]) => `${n}x ${what}`), []);
});
