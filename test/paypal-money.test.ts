/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies of the fake PayPal are loose JSON */
// The money calls against a fake PayPal (fetch is stubbed): what is sent, and what happens when
// PayPal says no, holds the money, or reports an authorization that is already gone.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Milestone } from '../lib/escrow/types.ts';

process.env.POD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-paypal-'));
process.env.PAYPAL_CLIENT_ID = 'test-id';
process.env.PAYPAL_SECRET = 'test-secret';
const payments = await import('../lib/escrow/payments.ts');

type Call = { path: string; body: any; headers: Record<string, string> };
let calls: Call[] = [];
let respond: (path: string, body: any) => { status?: number; json: unknown };

globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
  const pathname = new URL(url).pathname;
  const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
  calls.push({ path: pathname, body, headers: (init.headers ?? {}) as Record<string, string> });
  const r = pathname === '/v1/oauth2/token' ? { json: { access_token: 't', expires_in: 3600 } } : respond(pathname, body);
  return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
}) as typeof fetch;

beforeEach(() => {
  calls = [];
});

const milestone = { id: 'ms_pp', amount: '100.00', currency: 'USD', freelancer: { email: 'diego@example.com' }, payment: { mode: 'sandbox', authorizationId: 'AUTH1' } } as unknown as Milestone;
const posted = (p: string) => calls.filter((c) => c.path === p);

test('a capture PayPal leaves pending holds the payout instead of paying from the platform balance', async () => {
  respond = (p) => (p.endsWith('/capture') ? { json: { id: 'CAP1', status: 'PENDING', amount: { value: '100.00', currency_code: 'USD' } } } : { status: 500, json: {} });
  const result = await payments.releaseFunds(milestone, 'Work accepted');
  assert.match(result.payoutStatus ?? '', /^HELD/);
  assert.equal(posted('/v1/payments/payouts').length, 0, 'no payout before the money has arrived');
  assert.equal(posted('/v2/payments/authorizations/AUTH1/capture')[0].headers['PayPal-Request-Id'], 'capture-AUTH1');
});

test('a settlement captures only the agreed amount, as the final capture, and pays out that amount', async () => {
  respond = (p) =>
    p.endsWith('/capture')
      ? { json: { id: 'CAP2', status: 'COMPLETED', amount: { value: '60.00', currency_code: 'USD' } } }
      : { json: { batch_header: { payout_batch_id: 'B1', batch_status: 'PENDING' } } };
  const result = await payments.releaseFunds(milestone, 'Settled', '60.00');
  const capture = posted('/v2/payments/authorizations/AUTH1/capture')[0].body;
  assert.deepEqual(capture.amount, { currency_code: 'USD', value: '60.00' });
  assert.equal(capture.final_capture, true, 'the rest of the hold goes back to the buyer');
  assert.equal(posted('/v1/payments/payouts')[0].body.items[0].amount.value, '60.00');
  assert.equal(result.capturedAmount, '60.00');
});

test('a declined capture throws, and nothing is paid out', async () => {
  respond = (p) => (p.endsWith('/capture') ? { json: { id: 'CAP3', status: 'DECLINED' } } : { json: {} });
  await assert.rejects(payments.releaseFunds(milestone, 'x'), /declined the capture/);
  assert.equal(posted('/v1/payments/payouts').length, 0);
});

test('funding refuses a denied authorization and an amount that is not the milestone amount', async () => {
  const order = (status: string, value: string) => ({ json: { id: 'O1', purchase_units: [{ payments: { authorizations: [{ id: 'A9', status, amount: { value, currency_code: 'USD' } }] } }] } });
  respond = () => order('DENIED', '100.00');
  await assert.rejects(payments.completeFunding('O1', { amount: '100.00', currency: 'USD' }), /denied the authorization/);
  respond = () => order('CREATED', '1.00');
  await assert.rejects(payments.completeFunding('O1', { amount: '100.00', currency: 'USD' }), /expected 100.00 USD/);
  respond = () => order('CREATED', '100.00');
  assert.equal((await payments.completeFunding('O1', { amount: '100.00', currency: 'USD' })).authorizationId, 'A9');
});

test('cancelling an authorization PayPal already voided still cancels; other errors do not', async () => {
  respond = () => ({ status: 422, json: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'PREVIOUSLY_VOIDED' }] } });
  assert.equal((await payments.cancelFunding(milestone)).authorizationStatus, 'VOIDED');
  respond = () => ({ status: 400, json: { name: 'INVALID_REQUEST' } });
  await assert.rejects(payments.cancelFunding(milestone), /PayPal 400/);
});
