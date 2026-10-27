/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies of the fake PayPal are loose JSON */
// PayPal webhooks against a fake PayPal (fetch is stubbed): each event is applied once, a completed
// capture releases a held payout, and only a signature PayPal confirms is trusted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Milestone } from '../lib/escrow/types.ts';

process.env.POD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-webhooks-'));
process.env.PAYPAL_CLIENT_ID = 'test-id';
process.env.PAYPAL_SECRET = 'test-secret';
const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const paypal = await import('../lib/paypal.ts');

const calls: { path: string; body: any }[] = [];
let verification = 'SUCCESS';
globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
  const p = new URL(url).pathname;
  const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : undefined;
  calls.push({ path: p, body });
  const json =
    p === '/v1/oauth2/token'
      ? { access_token: 't', expires_in: 3600 }
      : p === '/v1/notifications/verify-webhook-signature'
        ? { verification_status: verification }
        : p === '/v1/payments/payouts'
          ? { batch_header: { payout_batch_id: 'BATCH9', batch_status: 'PENDING' } }
          : {};
  return new Response(JSON.stringify(json), { status: 200 });
}) as typeof fetch;

function milestone(over: Partial<Milestone['payment']> = {}, status: Milestone['status'] = 'released'): Milestone {
  const m = service.createMilestone({ title: 'Webhook test', criteria: ['Done'], amount: 100, clientName: 'C', clientEmail: 'c@example.com', freelancerName: 'F', freelancerEmail: 'f@example.com' });
  return store.updateMilestone(m.id, (x) => {
    x.status = status;
    x.payment = { mode: 'sandbox', orderId: 'O1', authorizationId: `AUTH-${m.id}`, ...over };
  });
}
const payouts = () => calls.filter((c) => c.path === '/v1/payments/payouts').length;

test('a completed capture releases a held payout, and a redelivery does nothing', async () => {
  const m = milestone({ captureId: 'CAP-HELD', payoutStatus: 'HELD: capture is pending, payout waits for it' });
  const before = payouts();
  assert.equal(await service.applyWebhook({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-HELD' } }), 'applied');
  const after = store.getMilestone(m.id)!;
  assert.equal(after.payment.payoutBatchId, 'BATCH9');
  assert.equal(after.payment.payoutStatus, 'PENDING');
  assert.equal(payouts() - before, 1);
  assert.equal(await service.applyWebhook({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-HELD' } }), 'duplicate');
  assert.equal(payouts() - before, 1, 'no second payout');
});

test('payout events update the payout status; events for nobody are ignored', async () => {
  const ok = milestone({ captureId: 'CAP-A', payoutBatchId: 'B-A', payoutStatus: 'PENDING' });
  assert.equal(await service.applyWebhook({ id: 'WH-2', event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resource: { payout_batch_id: 'B-A', payout_item: { sender_item_id: ok.id } } }), 'applied');
  assert.equal(store.getMilestone(ok.id)!.payment.payoutStatus, 'SUCCESS');
  assert.equal(store.getMilestone(ok.id)!.timeline.filter((e) => e.type === 'payout_completed').length, 1);

  const bad = milestone({ captureId: 'CAP-B', payoutBatchId: 'B-B', payoutStatus: 'PENDING' });
  await service.applyWebhook({ id: 'WH-3', event_type: 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED', resource: { payout_item: { sender_item_id: bad.id } } });
  assert.equal(store.getMilestone(bad.id)!.payment.payoutStatus, 'UNCLAIMED');

  assert.equal(await service.applyWebhook({ id: 'WH-4', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'SOMEONE-ELSES' } }), 'ignored');
});

test('an authorization voided on PayPal closes an open milestone', async () => {
  const m = milestone({}, 'funded');
  await service.applyWebhook({ id: 'WH-5', event_type: 'PAYMENT.AUTHORIZATION.VOIDED', resource: { id: m.payment.authorizationId } });
  const after = store.getMilestone(m.id)!;
  assert.equal(after.status, 'cancelled');
  assert.equal(after.payment.authorizationStatus, 'VOIDED');
});

test('only a signature PayPal confirms is trusted, checked with our webhook id', async () => {
  const headers = new Headers({ 'paypal-transmission-id': 'T1', 'paypal-transmission-sig': 'SIG', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.sandbox.paypal.com/cert', 'paypal-transmission-time': '2026-10-27T00:00:00Z' });
  const event = { id: 'WH-6', event_type: 'PAYMENT.CAPTURE.COMPLETED' };
  verification = 'SUCCESS';
  assert.equal(await paypal.verifyWebhookSignature(headers, event, 'WEBHOOK-1'), true);
  const sent = calls.findLast((c) => c.path === '/v1/notifications/verify-webhook-signature')!.body;
  assert.equal(sent.webhook_id, 'WEBHOOK-1');
  assert.equal(sent.transmission_sig, 'SIG');
  assert.deepEqual(sent.webhook_event, event);
  verification = 'FAILURE';
  assert.equal(await paypal.verifyWebhookSignature(headers, event, 'WEBHOOK-1'), false);
});
