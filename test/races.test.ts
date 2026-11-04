// Two people (or two clicks) acting on the same deal at the same moment, and amounts nobody should be
// able to enter. In simulated mode, against a throwaway data directory.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-races-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const input = (over: Record<string, unknown> = {}) => ({
  title: 'Menu for a cafe',
  criteria: ['The menu lists at least 6 items with prices'],
  amount: 100,
  clientName: 'Maya',
  clientEmail: 'maya@example.com',
  freelancerName: 'Diego',
  freelancerEmail: 'diego@example.com',
  ...over,
});

async function funded() {
  const m = service.createMilestone(input());
  const { clientKey, freelancerKey } = m.access!;
  const { orderId } = await service.beginFunding(m.id, clientKey);
  await service.confirmFunding(m.id, orderId, clientKey);
  return { id: m.id, clientKey: clientKey!, freelancerKey: freelancerKey! };
}
const count = (id: string, type: string) => store.getMilestone(id)!.timeline.filter((e) => e.type === type).length;

test('cancel and pay clicked at the same moment: exactly one of them happens', async () => {
  const { id, clientKey } = await funded();
  const results = await Promise.allSettled([service.clientDecision(id, 'cancel', '', clientKey), service.clientDecision(id, 'approve', '', clientKey)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const m = store.getMilestone(id)!;
  assert.ok(m.status === 'cancelled' || m.status === 'released');
  assert.equal(count(id, 'captured') + count(id, 'cancelled'), 1);
});

test('an offer accepted twice at once is captured once', async () => {
  const { id, clientKey, freelancerKey } = await funded();
  store.updateMilestone(id, (x) => void (x.status = 'escalated'));
  await service.settle(id, { action: 'propose', amount: 60 }, freelancerKey);
  const results = await Promise.allSettled([service.settle(id, { action: 'accept' }, clientKey), service.settle(id, { action: 'accept' }, clientKey)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(count(id, 'captured'), 1);
  assert.equal(store.getMilestone(id)!.payment.capturedAmount, '60.00');
});

test('two refunds at once never return more than was captured', async () => {
  const { id, clientKey, freelancerKey } = await funded();
  await service.clientDecision(id, 'approve', '', clientKey);
  await service.afterPayment(id, { action: 'complain', text: 'Two items are missing from the menu', amount: 80 }, clientKey);
  await Promise.allSettled([service.afterPayment(id, { action: 'refund', amount: 80 }, freelancerKey), service.afterPayment(id, { action: 'refund', amount: 80 }, freelancerKey)]);
  const refunded = (store.getMilestone(id)!.payment.refunds ?? []).reduce((n, r) => n + Number(r.amount), 0);
  assert.equal(refunded, 80, 'the first refund went through, the second found only 20 left');
});

test('amounts must be whole cents, finite and inside the limits', () => {
  for (const amount of [10.005, 99.999, Number.NaN, Number.POSITIVE_INFINITY, 1e12, -5, 0.5, '12abc']) {
    assert.throws(() => service.createMilestone(input({ amount })), Error, `amount ${amount}`);
  }
  assert.equal(service.createMilestone(input({ amount: 120.5 })).amount, '120.50');
});

test('the two secret links are encrypted in the data file, and still work', async () => {
  const { id, clientKey, freelancerKey } = await funded();
  const file = fs.readFileSync(path.join(dataDir, 'milestones.json'), 'utf8');
  assert.ok(!file.includes(clientKey) && !file.includes(freelancerKey), 'no key in the file');
  assert.match(file, /"sealed": "v1\./);
  assert.equal(store.getMilestone(id)!.access!.clientKey, clientKey);
  await service.clientDecision(id, 'cancel', '', clientKey);
  // A deal saved before keys were sealed still reads, and is sealed on its next save.
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'milestones.json'), 'utf8'));
  db.milestones.find((m: { id: string }) => m.id === id).access = { clientKey: 'old-client', freelancerKey: 'old-freelancer' };
  fs.writeFileSync(path.join(dataDir, 'milestones.json'), JSON.stringify(db));
  assert.equal(store.getMilestone(id)!.access!.clientKey, 'old-client');
  store.updateMilestone(id, () => {});
  assert.ok(!fs.readFileSync(path.join(dataDir, 'milestones.json'), 'utf8').includes('old-client'));
});
