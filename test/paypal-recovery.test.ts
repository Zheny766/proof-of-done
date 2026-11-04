/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies of the fake PayPal are loose JSON */
// What happens when PayPal's answer is lost, late, out of order or not what was asked for, against a
// fake PayPal (fetch is stubbed). The rule in every case: money moves once, and the deal says what
// really happened at PayPal.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Milestone } from '../lib/escrow/types.ts';

process.env.POD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-recovery-'));
process.env.PAYPAL_CLIENT_ID = 'test-id';
process.env.PAYPAL_SECRET = 'test-secret';
const payments = await import('../lib/escrow/payments.ts');
const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const paypal = await import('../lib/paypal.ts');

type Call = { method: string; path: string; body: any };
let calls: Call[] = [];
let respond: (method: string, path: string, body: any) => { status?: number; json: unknown };

globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
  const pathname = new URL(url).pathname;
  const method = init.method ?? 'GET';
  const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
  calls.push({ method, path: pathname, body });
  const r = pathname === '/v1/oauth2/token' ? { json: { access_token: 't', expires_in: 3600 } } : respond(method, pathname, body);
  return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
}) as typeof fetch;

beforeEach(() => {
  calls = [];
});

const deal = (payment: Partial<Milestone['payment']> = {}) =>
  ({
    id: 'ms_rec',
    amount: '100.00',
    currency: 'USD',
    freelancer: { email: 'diego@example.com' },
    payment: { mode: 'sandbox', orderId: 'ORDER1', authorizationId: 'AUTH1', expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), ...payment },
  }) as unknown as Milestone;
const posts = (p: string) => calls.filter((c) => c.method === 'POST' && c.path === p);
const completed = (id: string, value = '100.00') => ({ id, status: 'COMPLETED', amount: { value, currency_code: 'USD' }, seller_receivable_breakdown: { net_amount: { value: '96.20', currency_code: 'USD' } } });

test('a capture whose answer was lost is found on the order, not taken twice', async () => {
  // Our first capture went through but the server never saw the answer; the retry is refused as
  // already captured, and the capture is read back from the order.
  respond = (method, p) =>
    p.endsWith('/capture')
      ? { status: 422, json: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'AUTHORIZATION_ALREADY_CAPTURED' }] } }
      : p === '/v2/checkout/orders/ORDER1'
        ? { json: { id: 'ORDER1', purchase_units: [{ payments: { captures: [{ ...completed('CAP-EARLIER'), supplementary_data: { related_ids: { authorization_id: 'AUTH1' } } }] } }] } }
        : p === '/v1/payments/payouts'
          ? { json: { batch_header: { payout_batch_id: 'B1', batch_status: 'PENDING' } } }
          : { status: 404, json: {} };
  const result = await payments.releaseFunds(deal(), 'Work accepted');
  assert.equal(result.captureId, 'CAP-EARLIER');
  assert.equal(posts('/v2/payments/authorizations/AUTH1/capture').length, 1, 'one capture attempt, no second one');
  assert.equal(posts('/v1/payments/payouts').length, 1);
  assert.equal(result.payoutAmount, '96.20', 'paid from what PayPal actually captured, after its fee');
});

test('a payout sent before (its answer lost) is followed to PayPal’s batch, never sent again', async () => {
  // PayPal's real answer to a reused sender_batch_id: a 400 that links to the batch it already has.
  const duplicate = {
    name: 'USER_BUSINESS_ERROR',
    details: [{ field: 'SENDER_BATCH_ID', issue: 'Batch with given sender_batch_id already exists', link: [{ href: 'https://api.sandbox.paypal.com/v1/payments/payouts/UW9PA5HUJWAX6', rel: 'self', method: 'GET' }] }],
  };
  respond = (method, p) =>
    p.endsWith('/capture')
      ? { json: completed('CAP2') }
      : p === '/v1/payments/payouts'
        ? { status: 400, json: duplicate }
        : p === '/v1/payments/payouts/UW9PA5HUJWAX6'
          ? { json: { batch_header: { payout_batch_id: 'UW9PA5HUJWAX6', batch_status: 'SUCCESS' } } }
          : { status: 404, json: {} };
  const result = await payments.releaseFunds(deal(), 'Work accepted');
  assert.equal(result.payoutBatchId, 'UW9PA5HUJWAX6');
  assert.equal(result.payoutStatus, 'SUCCESS');
  assert.equal(posts('/v1/payments/payouts').length, 1);
  assert.equal(paypal.existingPayoutBatch(new paypal.PayPalApiError(500, '/v1/payments/payouts', 'INTERNAL_SERVER_ERROR')), null);
});

test('a capture for a different amount than the deal is recorded, and nobody is paid until a person looks', async () => {
  respond = (method, p) => (p.endsWith('/capture') ? { json: completed('CAP3', '1000.00') } : { status: 404, json: {} });
  const result = await payments.releaseFunds(deal(), 'Work accepted');
  assert.equal(result.captureId, 'CAP3');
  assert.match(result.payoutStatus ?? '', /^HELD: PayPal captured 1000\.00/);
  assert.equal(posts('/v1/payments/payouts').length, 0);
});

test('a hold past PayPal’s 29 days is not captured, and the reason is plain', async () => {
  respond = () => ({ status: 500, json: {} });
  await assert.rejects(payments.releaseFunds(deal({ expiresAt: new Date(Date.now() - 3_600_000).toISOString() }), 'Work accepted'), /hold ended/);
  assert.equal(calls.length, 0, 'PayPal is not even asked');
});

test('a hold PayPal already voided (the void’s answer was lost) is not captured', async () => {
  respond = (method, p) => (p.endsWith('/capture') ? { status: 422, json: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'AUTHORIZATION_VOIDED' }] } } : { status: 404, json: {} });
  await assert.rejects(payments.releaseFunds(deal(), 'Work accepted'), /already voided or has expired/);
  assert.equal(posts('/v1/payments/payouts').length, 0);
});

function webhookDeal(payment: Partial<Milestone['payment']>, status: Milestone['status']): Milestone {
  const m = service.createMilestone({ title: 'Webhook order', criteria: ['Done'], amount: 100, clientName: 'C', clientEmail: 'c@example.com', freelancerName: 'F', freelancerEmail: 'f@example.com' });
  return store.updateMilestone(m.id, (x) => {
    x.status = status;
    x.payment = { mode: 'sandbox', orderId: 'O1', authorizationId: `AUTH-${m.id}`, ...payment };
  });
}

test('PayPal events out of order: a stale one never undoes what already happened', async () => {
  respond = () => ({ json: {} });
  // A payout that succeeded stays succeeded when an older "unclaimed" or "failed" event turns up.
  const paid = webhookDeal({ captureId: 'CAPX', payoutBatchId: 'BX', payoutStatus: 'SUCCESS' }, 'released');
  await service.applyWebhook({ id: 'WH-1', event_type: 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED', resource: { payout_item: { sender_item_id: paid.id } } as any });
  await service.applyWebhook({ id: 'WH-2', event_type: 'PAYMENT.PAYOUTS-ITEM.FAILED', resource: { payout_item: { sender_item_id: paid.id } } as any });
  assert.equal(store.getMilestone(paid.id)!.payment.payoutStatus, 'SUCCESS');
  // A late "capture denied" can't mark a payout that went out as not sent.
  await service.applyWebhook({ id: 'WH-3', event_type: 'PAYMENT.CAPTURE.DENIED', resource: { id: 'CAPX' } as any });
  assert.equal(store.getMilestone(paid.id)!.payment.payoutStatus, 'SUCCESS');
  // A returned payout does come after success, and is recorded.
  await service.applyWebhook({ id: 'WH-4', event_type: 'PAYMENT.PAYOUTS-ITEM.RETURNED', resource: { payout_item: { sender_item_id: paid.id } } as any });
  assert.equal(store.getMilestone(paid.id)!.payment.payoutStatus, 'RETURNED');
});

test('the old authorization ending after a renewal does not cancel the deal', async () => {
  respond = () => ({ json: {} });
  const m = webhookDeal({ authorizationId: 'AUTH-NEW', previousAuthorizationId: 'AUTH-OLD' }, 'funded');
  await service.applyWebhook({ id: 'WH-5', event_type: 'PAYMENT.AUTHORIZATION.VOIDED', resource: { id: 'AUTH-OLD' } as any });
  assert.equal(store.getMilestone(m.id)!.status, 'funded', 'the renewed hold is still there');
  await service.applyWebhook({ id: 'WH-6', event_type: 'PAYMENT.AUTHORIZATION.VOIDED', resource: { id: 'AUTH-NEW' } as any });
  assert.equal(store.getMilestone(m.id)!.status, 'cancelled');
});
