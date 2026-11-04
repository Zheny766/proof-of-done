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

test('an amount lowered by agreement after the hold is captured as that amount, the final capture', async () => {
  respond = (p) =>
    p.endsWith('/capture')
      ? { json: { id: 'CAP3', status: 'COMPLETED', amount: { value: '90.00', currency_code: 'USD' } } }
      : { json: { batch_header: { payout_batch_id: 'B2', batch_status: 'PENDING' } } };
  const lowered = { ...milestone, amount: '90.00', payment: { ...milestone.payment, authorizedAmount: '120.00' } } as Milestone;
  const result = await payments.releaseFunds(lowered, 'Work accepted');
  const capture = posted('/v2/payments/authorizations/AUTH1/capture')[0].body;
  assert.deepEqual(capture.amount, { currency_code: 'USD', value: '90.00' });
  assert.equal(capture.final_capture, true);
  assert.equal(posted('/v1/payments/payouts')[0].body.items[0].amount.value, '90.00');
  assert.equal(result.capturedAmount, undefined, 'the deal amount is what was captured');
});

test('the capture note carries the record fingerprint, so PayPal holds it', async () => {
  respond = (p) =>
    p.endsWith('/capture')
      ? { json: { id: 'CAP4', status: 'COMPLETED', amount: { value: '100.00', currency_code: 'USD' } } }
      : { json: { batch_header: { payout_batch_id: 'B3', batch_status: 'PENDING' } } };
  const hash = 'ab'.repeat(32);
  const sealed = { ...milestone, timeline: [{ at: '', actor: 'client', type: 'approved', text: 'ok', hash }] } as Milestone;
  const result = await payments.releaseFunds(sealed, 'Work accepted');
  assert.equal(posted('/v2/payments/authorizations/AUTH1/capture')[0].body.note_to_payer, `Proof of Done record ${hash.slice(0, 16)}. Work accepted`);
  assert.equal(result.anchoredRecord, hash);
});

test('a call PayPal never answered is sent again with the same idempotency key', async () => {
  let dropped = false;
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (!dropped && new URL(url).pathname.endsWith('/capture')) {
      dropped = true;
      calls.push({ path: new URL(url).pathname, body: null, headers: (init?.headers ?? {}) as Record<string, string> });
      throw new TypeError('fetch failed');
    }
    return real(url, init);
  }) as typeof fetch;
  try {
    respond = (p) =>
      p.endsWith('/capture')
        ? { json: { id: 'CAP9', status: 'COMPLETED', amount: { value: '100.00', currency_code: 'USD' } } }
        : { json: { batch_header: { payout_batch_id: 'B9', batch_status: 'PENDING' } } };
    const result = await payments.releaseFunds(milestone, 'Work accepted');
    const tries = posted('/v2/payments/authorizations/AUTH1/capture');
    assert.equal(tries.length, 2);
    assert.deepEqual(tries.map((c) => c.headers['PayPal-Request-Id']), ['capture-AUTH1', 'capture-AUTH1']);
    assert.equal(result.captureId, 'CAP9');
  } finally {
    globalThis.fetch = real;
  }
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

const old = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const ahead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const aged = { ...milestone, payment: { ...milestone.payment, honorExpiresAt: old(1), expiresAt: ahead(25) } } as Milestone;

test('a hold past its 3-day honor period is reauthorized once, under a new authorization id', async () => {
  respond = (p) => (p.endsWith('/reauthorize') ? { json: { id: 'AUTH2', status: 'CREATED', amount: { value: '100.00', currency_code: 'USD' }, expiration_time: ahead(25) } } : { status: 500, json: {} });
  const renewed = await payments.renewHold(aged);
  assert.equal(renewed?.authorizationId, 'AUTH2');
  assert.equal(renewed?.previousAuthorizationId, 'AUTH1');
  assert.ok(Date.parse(renewed!.honorExpiresAt!) > Date.now() + 2 * 86_400_000, 'a fresh 3-day guarantee');
  const call = posted('/v2/payments/authorizations/AUTH1/reauthorize')[0];
  assert.deepEqual(call.body.amount, { currency_code: 'USD', value: '100.00' });
  assert.equal(call.headers['PayPal-Request-Id'], 'reauth-AUTH1');
  // Nothing to do inside the honor period, after a renewal, after a capture, or once the hold expired.
  for (const p of [{ honorExpiresAt: ahead(1) }, { reauthorizedAt: old(0) }, { captureId: 'CAP' }, { expiresAt: old(1) }]) {
    assert.equal(await payments.renewHold({ ...aged, payment: { ...aged.payment, ...p } } as Milestone), null);
  }
  assert.equal(posted('/v2/payments/authorizations/AUTH1/reauthorize').length, 1);
});

test('capturing an aged hold renews it first and captures the new authorization', async () => {
  respond = (p) =>
    p.endsWith('/reauthorize')
      ? { json: { id: 'AUTH2', status: 'CREATED', amount: { value: '100.00', currency_code: 'USD' } } }
      : p.endsWith('/capture')
        ? { json: { id: 'CAP2', status: 'COMPLETED', amount: { value: '100.00', currency_code: 'USD' } } }
        : p === '/v1/payments/payouts'
          ? { json: { batch_header: { payout_batch_id: 'B2', batch_status: 'PENDING' } } }
          : { status: 500, json: {} };
  const result = await payments.releaseFunds(aged, 'Work accepted');
  assert.equal(posted('/v2/payments/authorizations/AUTH2/capture').length, 1);
  assert.equal(posted('/v2/payments/authorizations/AUTH1/capture').length, 0);
  assert.equal(result.authorizationStatus, 'CAPTURED');
  assert.equal(result.previousAuthorizationId, 'AUTH1');
});

test('if PayPal refuses the renewal, the capture still tries the original hold', async () => {
  respond = (p) =>
    p.endsWith('/reauthorize')
      ? { status: 422, json: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'REAUTHORIZATION_NOT_ALLOWED' }] } }
      : p.endsWith('/capture')
        ? { json: { id: 'CAP1', status: 'COMPLETED', amount: { value: '100.00', currency_code: 'USD' } } }
        : p === '/v1/payments/payouts'
          ? { json: { batch_header: { payout_batch_id: 'B1', batch_status: 'PENDING' } } }
          : { status: 500, json: {} };
  const result = await payments.releaseFunds(aged, 'Work accepted');
  assert.equal(posted('/v2/payments/authorizations/AUTH1/capture').length, 1);
  assert.equal(result.reauthorizedAt, undefined);
});
