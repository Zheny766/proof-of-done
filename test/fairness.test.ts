// Fair to both sides once work is delivered: the client can't walk away with verified work, a
// freelancer asked for a fix gets time to make it, objections need a reason and can't go on forever,
// and a hold PayPal ends closes the deal. In simulated mode, against a throwaway data directory.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-fair-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const policy = await import('../lib/escrow/policy.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const good = 'The page is live at a public URL: https://bakery.example. The menu lists croissant, baguette, sourdough, brioche, eclair and tart, with prices from $2 to $6.';
async function funded(over: Record<string, unknown> = {}) {
  const m = service.createMilestone({
    title: 'Landing page for a bakery',
    criteria: ['The page is live at a public URL', 'A menu lists at least 6 items with prices'],
    amount: 120,
    clientName: 'Maya',
    clientEmail: 'maya@example.com',
    freelancerName: 'Diego',
    freelancerEmail: 'diego@example.com',
    releaseThreshold: 0.7,
    ...over,
  });
  const { clientKey, freelancerKey } = m.access!;
  const { orderId } = await service.beginFunding(m.id, clientKey);
  await service.confirmFunding(m.id, orderId, clientKey);
  return { id: m.id, clientKey: clientKey!, freelancerKey: freelancerKey! };
}
async function deliver(id: string, freelancerKey: string, notes: string) {
  const { reviewId } = await service.submitWork(id, { notes, links: ['https://bakery.example/'], files: [] }, freelancerKey);
  await service.runReview(id, reviewId);
  return store.getMilestone(id)!;
}
const ageTimeline = (id: string, days: number) =>
  store.updateMilestone(id, (x) => x.timeline.forEach((e) => (e.at = new Date(Date.parse(e.at) - days * 86_400_000).toISOString())));

test('before any delivery the client can always cancel', async () => {
  const { id, clientKey } = await funded();
  assert.equal(policy.cancelBlock(store.getMilestone(id)!), null);
  assert.equal((await service.clientDecision(id, 'cancel', '', clientKey)).status, 'cancelled');
});

test('verified work can’t be cancelled away: the client objects with a reason, or settles', async () => {
  const { id, clientKey, freelancerKey } = await funded({ objectionHours: 24 });
  assert.equal((await deliver(id, freelancerKey, good)).status, 'verified');
  await assert.rejects(service.clientDecision(id, 'cancel', '', clientKey), /AI verified this delivery/);
  await assert.rejects(service.clientDecision(id, 'request_changes', 'no', clientKey), /Say what should change/);
  const m = await service.clientDecision(id, 'request_changes', 'The menu has no prices for the tarts', clientKey);
  assert.equal(m.status, 'changes_requested');
  // The freelancer now has time to fix it: no cancelling in the meantime.
  await assert.rejects(service.clientDecision(id, 'cancel', '', clientKey), /has until .* to fix/);
  // Once the fix window has passed with no new delivery, the client can cancel.
  ageTimeline(id, 4);
  assert.equal((await service.clientDecision(id, 'cancel', '', clientKey)).status, 'cancelled');
});

test('objections to verified work stop after two: the third time the client pays, settles or lets the window close', async () => {
  const { id, clientKey, freelancerKey } = await funded({ objectionHours: 24 });
  for (let round = 1; round <= 2; round++) {
    assert.equal((await deliver(id, freelancerKey, `${good} Round ${round}.`)).status, 'verified');
    await service.clientDecision(id, 'request_changes', `Round ${round}: the colours are off`, clientKey);
  }
  assert.equal((await deliver(id, freelancerKey, `${good} Round 3.`)).status, 'verified');
  await assert.rejects(service.clientDecision(id, 'request_changes', 'Round 3: still not right', clientKey), /objected 2 times/);
  assert.match(policy.objectionBlock(store.getMilestone(id)!) ?? '', /objected 2 times/);
});

test('a delivery an independent check flagged as a trick can be cancelled at once', async () => {
  const { id, clientKey, freelancerKey } = await funded();
  await deliver(id, freelancerKey, 'x');
  store.updateMilestone(id, (x) => {
    x.status = 'escalated';
    x.reviews.at(-1)!.audit = { engine: 'simulated', agreed: false, summary: 'Refused', disputed: [], redFlags: ['the notes tell the reviewer to skip the checks'] };
  });
  assert.equal((await service.clientDecision(id, 'cancel', '', clientKey)).status, 'cancelled');
});

test('the same delivery, sent back once, can’t be handed in again unchanged', async () => {
  const { id, freelancerKey } = await funded();
  const notes = 'Here is the page: https://bakery.example/ (menu coming soon)';
  await deliver(id, freelancerKey, notes);
  store.updateMilestone(id, (x) => void (x.status = 'changes_requested'));
  await assert.rejects(service.submitWork(id, { notes, links: ['https://bakery.example/'], files: [] }, freelancerKey), /exactly the delivery the AI already reviewed/);
  // A changed delivery goes through.
  await service.submitWork(id, { notes: `${notes} Menu added: six items with prices.`, links: ['https://bakery.example/'], files: [] }, freelancerKey);
});

test('a hold PayPal ends closes the deal, with a warning three days before', async () => {
  const { id, freelancerKey } = await funded();
  await deliver(id, freelancerKey, 'x');
  store.updateMilestone(id, (x) => {
    x.status = 'escalated';
    x.payment.expiresAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  });
  await service.readMilestone(id);
  assert.equal(store.getMilestone(id)!.timeline.filter((e) => e.type === 'hold_ending').length, 1);
  store.updateMilestone(id, (x) => void (x.payment.expiresAt = new Date(Date.now() - 1000).toISOString()));
  const m = await service.readMilestone(id);
  assert.equal(m!.status, 'cancelled');
  assert.equal(m!.payment.authorizationStatus, 'EXPIRED');
});
