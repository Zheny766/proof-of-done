// After the payment: the client reports a problem, the freelancer refunds all or part of it (PayPal
// returns it from the capture) or declines. Simulated mode against a throwaway data directory, plus a
// fake PayPal for the refund call itself.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Milestone } from '../lib/escrow/types.ts';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-refund-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const access = await import('../lib/escrow/access.ts');
const payments = await import('../lib/escrow/payments.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

async function paid(amount = 100) {
  const m = service.createMilestone({ title: 'Menu for a cafe', criteria: ['A one-page PDF menu'], amount, clientName: 'Maya', clientEmail: 'maya@example.com', freelancerName: 'Diego', freelancerEmail: 'diego@example.com' });
  const { clientKey, freelancerKey } = m.access!;
  const { orderId } = await service.beginFunding(m.id, clientKey);
  await service.confirmFunding(m.id, orderId, clientKey);
  await service.clientDecision(m.id, 'approve', '', clientKey);
  return { id: m.id, clientKey, freelancerKey };
}

test('the client reports a problem, the freelancer refunds part of it, and PayPal returns that much', async () => {
  const { id, clientKey, freelancerKey } = await paid();
  const asked = await service.afterPayment(id, { action: 'complain', text: 'Two prices are wrong', amount: 40 }, clientKey);
  assert.equal(asked.complaint?.status, 'open');
  assert.equal(asked.complaint?.amount, '40.00');

  const done = await service.afterPayment(id, { action: 'refund', amount: 25, note: 'Fair, for the two prices' }, freelancerKey);
  assert.equal(done.status, 'released', 'still a paid deal, with a refund on it');
  assert.equal(done.complaint?.status, 'refunded');
  assert.equal(done.payment.refunds?.length, 1);
  assert.equal(done.payment.refunds?.[0].amount, '25.00');
  assert.equal(payments.refundable(done), 75);
  assert.match(done.timeline.find((e) => e.type === 'refunded')!.text, /PayPal refunded 25.00 USD to Maya/);
});

test('only what was captured and not refunded can come back, and only the right side can act', async () => {
  const { id, clientKey, freelancerKey } = await paid();
  await assert.rejects(service.afterPayment(id, { action: 'complain', text: 'Wrong', amount: 150 }, clientKey), /at most 100.00 USD back/);
  await assert.rejects(service.afterPayment(id, { action: 'complain', text: 'Wrong' }, freelancerKey), /Only the client/);
  await service.afterPayment(id, { action: 'complain', text: 'Not what we asked for' }, clientKey);
  await assert.rejects(service.afterPayment(id, { action: 'complain', text: 'Again' }, clientKey), /already an open complaint/);
  await assert.rejects(service.afterPayment(id, { action: 'refund' }, clientKey), /Only the freelancer/);
  await assert.rejects(service.afterPayment(id, { action: 'refund' }, null), /Only the freelancer/);

  // The whole amount, by default what the client asked for.
  const all = await service.afterPayment(id, { action: 'refund' }, freelancerKey);
  assert.equal(payments.refundable(all), 0);
  await assert.rejects(service.afterPayment(id, { action: 'complain', text: 'More' }, clientKey), /already been refunded/);
});

test('the freelancer can decline (a PayPal dispute stays open to the client), and the client can withdraw', async () => {
  const { id, clientKey, freelancerKey } = await paid();
  await service.afterPayment(id, { action: 'complain', text: 'The logo is blurry' }, clientKey);
  const declined = await service.afterPayment(id, { action: 'decline', note: 'The logo is the vector file you approved' }, freelancerKey);
  assert.equal(declined.complaint?.status, 'declined');
  assert.match(declined.timeline.at(-1)!.text, /open a dispute with PayPal/);
  assert.equal(declined.payment.refunds, undefined);

  await service.afterPayment(id, { action: 'complain', text: 'Asking once more', amount: 10 }, clientKey);
  const withdrawn = await service.afterPayment(id, { action: 'withdraw' }, clientKey);
  assert.equal(withdrawn.complaint?.status, 'withdrawn');
  await assert.rejects(service.afterPayment(id, { action: 'refund' }, freelancerKey), /no open complaint/);
});

test('no complaint before the payment, or after the window', async () => {
  const m = service.createMilestone({ title: 'Logo', criteria: ['An SVG logo'], amount: 50, clientName: 'Maya', clientEmail: 'maya@example.com', freelancerName: 'Diego', freelancerEmail: 'diego@example.com' });
  await assert.rejects(service.afterPayment(m.id, { action: 'complain', text: 'Too early' }, m.access!.clientKey), /once the deal is paid/);

  const { id, clientKey } = await paid();
  store.updateMilestone(id, (x) => void (x.payment.capturedAt = new Date(Date.now() - 31 * 86_400_000).toISOString()));
  await assert.rejects(service.afterPayment(id, { action: 'complain', text: 'Late' }, clientKey), /within 30 days/);
});

test('someone without a link sees that there was a complaint, not what it said', async () => {
  const { id, clientKey, freelancerKey } = await paid();
  await service.afterPayment(id, { action: 'complain', text: 'The private reason' }, clientKey);
  await service.afterPayment(id, { action: 'decline', note: 'My private answer' }, freelancerKey);
  const seen = JSON.stringify(access.viewerMilestone(store.getMilestone(id)!));
  assert.ok(!seen.includes('private reason') && !seen.includes('private answer'));
  assert.equal(access.viewerMilestone(store.getMilestone(id)!).complaint?.status, 'declined');
});

test('a refunded-in-full delivery does not count as paid towards the freelancer standing', async () => {
  store.deleteAll();
  for (let i = 0; i < 3; i++) {
    const { id, clientKey, freelancerKey } = await paid(20);
    store.updateMilestone(id, (x) => void x.reviews.push({ id: `r${i}`, submissionId: 's', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), engine: 'simulated', findings: [], log: [] }));
    await service.afterPayment(id, { action: 'complain', text: 'Nothing usable' }, clientKey);
    await service.afterPayment(id, { action: 'refund' }, freelancerKey);
  }
  assert.equal(service.trustFor('diego@example.com').paid, 0);
});

test('on the PayPal sandbox the refund goes to the capture, with an idempotency key per refund', async () => {
  const calls: { path: string; body: { amount: { value: string } }; key: string }[] = [];
  const real = globalThis.fetch;
  process.env.PAYPAL_CLIENT_ID = 'test-id';
  process.env.PAYPAL_SECRET = 'test-secret';
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const { pathname } = new URL(url);
    if (pathname === '/v1/oauth2/token') return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    calls.push({ path: pathname, body: JSON.parse(String(init.body)), key: (init.headers as Record<string, string>)['PayPal-Request-Id'] });
    return new Response(JSON.stringify({ id: `REF${calls.length}`, status: 'COMPLETED' }), { status: 201 });
  }) as typeof fetch;
  try {
    const m = { id: 'ms_x', amount: '100.00', currency: 'USD', payment: { mode: 'sandbox', captureId: 'CAP1', refunds: [{ id: 'REF0', amount: '10.00', status: 'COMPLETED', at: '' }] } } as unknown as Milestone;
    const refund = await payments.refundToClient(m, 30, 'Refund for: Menu');
    assert.equal(calls[0].path, '/v2/payments/captures/CAP1/refund');
    assert.equal(calls[0].body.amount.value, '30.00');
    assert.equal(calls[0].key, 'refund-CAP1-2', 'the second refund on this capture');
    assert.equal(refund.id, 'REF1');
  } finally {
    globalThis.fetch = real;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_SECRET;
  }
});


test('a refund after the payout comes off the same freelancer’s next payout here', async () => {
  const first = await paid();
  await service.afterPayment(first.id, { action: 'complain', text: 'Two prices are wrong', amount: 30 }, first.clientKey);
  const refunded = await service.afterPayment(first.id, { action: 'refund' }, first.freelancerKey);
  assert.equal(refunded.payment.refundOwed, '30.00');
  assert.match(refunded.timeline.at(-1)!.text, /Diego had already been paid, so the platform refunded Maya; 30.00 USD comes off Diego's next payout/);

  // Diego's next deal: 30 of the payout covers that refund, and the debt is settled.
  const next = await paid();
  const m = store.getMilestone(next.id)!;
  assert.deepEqual([m.payment.payoutDeduction, m.payment.payoutAmount], ['30.00', '70.00']);
  assert.ok(m.timeline.some((e) => e.type === 'payout_deduction'));
  const third = await paid();
  assert.equal(store.getMilestone(third.id)!.payment.payoutDeduction, undefined, 'nothing more is owed');
});

test('on the sandbox an unclaimed payout is cancelled and the rest sent again, so nothing is owed', async () => {
  const calls: { method: string; path: string; body?: { items?: { amount: { value: string } }[]; sender_batch_header?: { sender_batch_id: string } } }[] = [];
  const real = globalThis.fetch;
  process.env.PAYPAL_CLIENT_ID = 'test-id';
  process.env.PAYPAL_SECRET = 'test-secret';
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const { pathname } = new URL(url);
    if (pathname === '/v1/oauth2/token') return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    calls.push({ method: init.method ?? 'GET', path: pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (pathname === '/v1/payments/payouts/BATCH1') return new Response(JSON.stringify({ batch_header: { payout_batch_id: 'BATCH1', batch_status: 'SUCCESS' }, items: [{ payout_item_id: 'ITEM1', transaction_status: 'UNCLAIMED' }] }));
    if (pathname === '/v1/payments/payouts') return new Response(JSON.stringify({ batch_header: { payout_batch_id: 'BATCH2', batch_status: 'PENDING' } }), { status: 201 });
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;
  try {
    const m = { id: 'ms_x', amount: '100.00', currency: 'USD', freelancer: { email: 'diego@example.com' }, payment: { mode: 'sandbox', captureId: 'CAP1', payoutBatchId: 'BATCH1', payoutAmount: '100.00' } } as unknown as Milestone;
    const out = await payments.recoverRefund(m, 40);
    assert.equal(out.cancelled, true);
    assert.ok(calls.some((c) => c.path === '/v1/payments/payouts-item/ITEM1/cancel'));
    const again = calls.find((c) => c.path === '/v1/payments/payouts')!;
    assert.equal(again.body!.items![0].amount.value, '60.00');
    assert.equal(again.body!.sender_batch_header!.sender_batch_id, 'pod-ms_x-2', 'its own batch id');
    assert.equal(out.refundOwed, undefined);
  } finally {
    globalThis.fetch = real;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_SECRET;
  }
});
