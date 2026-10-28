// Changing the terms of a deal: one side offers new criteria, a lower amount or another deadline, only
// the other side accepts, and the next review and payment follow the new terms. Simulated mode
// against a throwaway data directory.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-terms-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const policy = await import('../lib/escrow/policy.ts');
const payments = await import('../lib/escrow/payments.ts');
const access = await import('../lib/escrow/access.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const criteria = ['The page is live at a public URL', 'A menu lists at least 6 items with prices'];

function created(over: Record<string, unknown> = {}) {
  const m = service.createMilestone({ title: 'Landing page for a bakery', criteria, amount: 120, clientName: 'Maya', clientEmail: 'maya@example.com', freelancerName: 'Diego', freelancerEmail: 'diego@example.com', ...over });
  return { id: m.id, clientKey: m.access!.clientKey, freelancerKey: m.access!.freelancerKey };
}

async function funded(over: Record<string, unknown> = {}) {
  const deal = created(over);
  const { orderId } = await service.beginFunding(deal.id, deal.clientKey);
  await service.confirmFunding(deal.id, orderId, deal.clientKey);
  return deal;
}

test('a lower amount agreed after funding is what PayPal captures and pays out; the rest goes back', async () => {
  const { id, clientKey, freelancerKey } = await funded();
  const offered = await service.changeTerms(id, { action: 'propose', criteria: criteria.slice(0, 1), amount: 90, note: 'No menu after all' }, clientKey);
  assert.equal(offered.termsChange?.by, 'client');
  assert.match(offered.timeline.at(-1)!.text, /offered new terms \(1 criterion removed; amount 120.00 -> 90.00 USD\): No menu after all/);
  assert.equal(offered.amount, '120.00', 'nothing changes before the other side accepts');

  const changed = await service.changeTerms(id, { action: 'accept' }, freelancerKey);
  assert.equal(changed.amount, '90.00');
  assert.equal(changed.payment.authorizedAmount, '120.00', 'PayPal still holds what the client approved');
  assert.deepEqual(changed.criteria, [{ id: 'c1', text: criteria[0] }]);
  assert.equal(changed.termsChange, undefined);

  const paid = await service.clientDecision(id, 'approve', '', clientKey);
  assert.equal(paid.status, 'released');
  assert.equal(payments.refundable(paid), 90, 'what was captured');
  assert.match(paid.timeline.find((e) => e.type === 'captured')!.text, /PayPal captured 90.00 USD .*; the other 30.00 USD of the hold went back to Maya/);
});

test('the amount cannot go above the hold; only the other side accepts; the proposer can withdraw', async () => {
  const { id, clientKey, freelancerKey } = await funded();
  await assert.rejects(service.changeTerms(id, { action: 'propose', criteria, amount: 150 }, freelancerKey), /can't go above the 120.00 USD PayPal holds/);
  await assert.rejects(service.changeTerms(id, { action: 'propose', criteria, amount: 120 }, freelancerKey), /These are the current terms/);
  await assert.rejects(service.changeTerms(id, { action: 'propose', criteria, amount: 100 }, null), /Only the client or the freelancer/);

  await service.changeTerms(id, { action: 'propose', criteria, amount: 100 }, freelancerKey);
  await assert.rejects(service.changeTerms(id, { action: 'propose', criteria, amount: 110 }, clientKey), /already an open offer/);
  await assert.rejects(service.changeTerms(id, { action: 'accept' }, freelancerKey), /other party has to accept/);
  const withdrawn = await service.changeTerms(id, { action: 'decline' }, freelancerKey);
  assert.equal(withdrawn.termsChange, undefined);
  assert.match(withdrawn.timeline.at(-1)!.text, /Diego withdrew the offer of new terms/);
  assert.equal(withdrawn.amount, '120.00');

  // The same criterion twice is kept once.
  await service.changeTerms(id, { action: 'propose', criteria: [criteria[0], criteria[0].toUpperCase(), 'An Order button'], amount: 120 }, freelancerKey);
  assert.deepEqual((await service.changeTerms(id, { action: 'accept' }, clientKey)).criteria.map((c) => c.text), [criteria[0], 'An Order button']);
});

test('someone without a link sees that the terms changed, not the offer or why', async () => {
  const { id, clientKey } = await funded();
  const offered = await service.changeTerms(id, { action: 'propose', criteria, amount: 80, note: 'Budget cut by our CFO' }, clientKey);
  const seen = access.viewerMilestone(offered);
  assert.equal(seen.termsChange, undefined);
  assert.equal(seen.timeline.at(-1)!.text, 'Maya offered new terms (amount 120.00 -> 80.00 USD)');
});

test('before funding the amount can go up, and the PayPal order made for the old amount is dropped', async () => {
  const { id, clientKey, freelancerKey } = created();
  const { orderId } = await service.beginFunding(id, clientKey);
  await service.changeTerms(id, { action: 'propose', criteria, amount: 150 }, freelancerKey);
  const changed = await service.changeTerms(id, { action: 'accept' }, clientKey);
  assert.equal(changed.amount, '150.00');
  await assert.rejects(service.confirmFunding(id, orderId, clientKey), /not for this deal/, 'the old order would hold the old amount');
  const fresh = await service.beginFunding(id, clientKey);
  assert.equal((await service.confirmFunding(id, fresh.orderId, clientKey)).status, 'funded');
});

test('an offer above what the client then funded cannot be accepted; delivering the work ends an open offer', async () => {
  const { id, clientKey, freelancerKey } = created();
  await service.changeTerms(id, { action: 'propose', criteria, amount: 200 }, freelancerKey);
  const { orderId } = await service.beginFunding(id, clientKey);
  await service.confirmFunding(id, orderId, clientKey);
  await assert.rejects(service.changeTerms(id, { action: 'accept' }, clientKey), /PayPal now holds 120.00 USD, less than this offer/);

  await service.changeTerms(id, { action: 'decline' }, clientKey);
  await service.changeTerms(id, { action: 'propose', criteria, amount: 100 }, freelancerKey);
  const { milestone } = await service.submitWork(id, { notes: 'Here it is', links: [], files: [] }, freelancerKey);
  assert.equal(milestone.termsChange, undefined);
  assert.match(milestone.timeline.find((e) => e.type === 'terms_lapsed')!.text, /checked against the current terms/);
});

test('after new criteria the last review no longer counts, and a new deadline replaces the passed one', async () => {
  const { id, clientKey, freelancerKey } = await funded({ dueDays: 3 });
  const { reviewId } = await service.submitWork(id, { notes: 'Hello', links: [], files: [] }, freelancerKey);
  await service.runReview(id, reviewId);
  assert.equal(store.getMilestone(id)!.status, 'changes_requested');
  store.updateMilestone(id, (x) => void (x.dueAt = new Date(Date.now() - 1000).toISOString()));
  assert.ok(policy.isOverdue((await service.readMilestone(id))!));
  assert.ok(policy.currentReview(store.getMilestone(id)!));

  await service.changeTerms(id, { action: 'propose', criteria: [...criteria, 'The page has an "Order" button'], amount: 120, dueDays: 10 }, clientKey);
  const changed = await service.changeTerms(id, { action: 'accept' }, freelancerKey);
  assert.equal(policy.currentReview(changed), undefined, 'that review was against the old criteria');
  assert.equal(policy.isOverdue(changed), false);
  assert.equal(changed.dueDays, 10);
  assert.ok(Math.abs(Date.parse(changed.dueAt!) - (Date.parse(changed.payment.authorizedAt!) + 10 * 86_400_000)) < 5_000, 'still counted from the hold');
  assert.match(changed.timeline.at(-1)!.text, /Diego accepted the new terms \(1 criterion added; deadline 3 days -> 10 days\)/);

  const again = await service.submitWork(id, { notes: 'The page is live with an Order button', links: [], files: [] }, freelancerKey);
  await service.runReview(id, again.reviewId);
  assert.ok(policy.currentReview(store.getMilestone(id)!), 'the new review counts');
});

test('the terms are fixed once the work is being reviewed or paid, and on an untaken board job', async () => {
  const { id, clientKey, freelancerKey } = await funded();
  await service.clientDecision(id, 'approve', '', clientKey);
  await assert.rejects(service.changeTerms(id, { action: 'propose', criteria, amount: 50 }, freelancerKey), /The terms can't change now/);

  const job = service.createMilestone({ title: 'Logo', criteria: ['An SVG logo file'], amount: 40, clientName: 'Maya', clientEmail: 'maya@example.com', postToBoard: true });
  await assert.rejects(service.changeTerms(job.id, { action: 'propose', criteria: ['An SVG and a PNG logo'], amount: 40 }, job.access!.clientKey), /Nobody has taken this job/);
});
