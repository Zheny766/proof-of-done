import 'server-only';
// Money moves for a milestone. Real sandbox calls when PayPal keys are set, otherwise simulated
// (and labelled as such in the UI) so the app runs without any keys.

import crypto from 'node:crypto';
import {
  authorizeOrder,
  captureAuthorization,
  createAuthorizeOrder,
  createPayout,
  getPayoutBatch,
  isPayPalConfigured,
  PayPalApiError,
  reauthorizeAuthorization,
  refundCapture,
  voidAuthorization,
} from '../paypal.ts';
import type { Milestone, PaymentState } from './types.ts';

export const paymentMode = (): PaymentState['mode'] => (isPayPalConfigured() ? 'sandbox' : 'simulated');

const fakeId = (prefix: string) => `${prefix}-SIM-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

/** Platform fee kept when paying the freelancer out (0 = everything goes to the freelancer). */
export const PLATFORM_FEE_PCT = (() => {
  const pct = Number(process.env.POD_PLATFORM_FEE_PCT || 0);
  return Number.isFinite(pct) && pct >= 0 && pct < 100 ? pct : 0;
})();

export async function startFunding(m: Milestone): Promise<{ orderId: string }> {
  if (paymentMode() === 'simulated') return { orderId: fakeId('ORDER') };
  const order = await createAuthorizeOrder({ milestoneId: m.id, title: m.title, amount: m.amount, currency: m.currency });
  return { orderId: order.id };
}

export async function completeFunding(orderId: string, expected?: { amount: string; currency: string }): Promise<Partial<PaymentState>> {
  // A simulated order id is only acceptable when the whole app runs without PayPal credentials.
  if (orderId.includes('-SIM-') && paymentMode() === 'sandbox') throw new Error('Simulated orders are not accepted in sandbox mode.');
  if (paymentMode() === 'simulated') {
    return {
      mode: 'simulated',
      orderId,
      authorizationId: fakeId('AUTH'),
      authorizationStatus: 'CREATED',
      authorizedAt: new Date().toISOString(),
      honorExpiresAt: days(3),
      expiresAt: days(29),
      payerEmail: 'buyer@sandbox.example',
    };
  }
  const order = await authorizeOrder(orderId);
  const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error('PayPal did not return an authorization for this order');
  // No hold, no funding: a denied authorization must not mark the milestone as funded.
  if (auth.status === 'DENIED' || auth.status === 'VOIDED') throw new Error(`PayPal ${auth.status.toLowerCase()} the authorization. Nothing is on hold.`);
  if (expected && (auth.amount.value !== expected.amount || auth.amount.currency_code !== expected.currency)) {
    throw new Error(`PayPal authorized ${auth.amount.value} ${auth.amount.currency_code}, expected ${expected.amount} ${expected.currency}.`);
  }
  return {
    mode: 'sandbox',
    orderId,
    authorizationId: auth.id,
    authorizationStatus: auth.status,
    authorizedAt: auth.create_time ?? new Date().toISOString(),
    honorExpiresAt: days(3),
    expiresAt: auth.expiration_time ?? days(29),
    payerEmail: order.payer?.email_address,
  };
}

/** Has the hold outlived PayPal's 3-day guarantee without being renewed yet? */
export function holdNeedsRenewal(p: PaymentState, now = Date.now()): boolean {
  if (!p.authorizationId || p.captureId || p.voidedAt || p.reauthorizedAt || !p.honorExpiresAt) return false;
  if (p.expiresAt && Date.parse(p.expiresAt) <= now) return false;
  return Date.parse(p.honorExpiresAt) <= now;
}

/**
 * PayPal guarantees held funds for 3 days, and a job often takes longer. Once that honor period has
 * passed, reauthorize the hold (PayPal allows it once, up to day 29): the money is guaranteed for 3
 * more days under a new authorization id. Null when the hold doesn't need it.
 */
export async function renewHold(m: Milestone): Promise<Partial<PaymentState> | null> {
  const p = m.payment;
  if (!holdNeedsRenewal(p)) return null;
  const reauthorizedAt = new Date().toISOString();
  if (p.mode === 'simulated') {
    return { authorizationId: fakeId('AUTH'), authorizationStatus: 'CREATED', previousAuthorizationId: p.authorizationId, reauthorizedAt, honorExpiresAt: days(3) };
  }
  const auth = await reauthorizeAuthorization(p.authorizationId!, { currency_code: m.currency, value: m.amount });
  if (auth.status === 'DENIED' || auth.status === 'VOIDED') throw new Error(`PayPal ${auth.status.toLowerCase()} the reauthorization (${auth.id}).`);
  return {
    authorizationId: auth.id,
    authorizationStatus: auth.status,
    previousAuthorizationId: p.authorizationId,
    reauthorizedAt,
    honorExpiresAt: days(3),
    expiresAt: auth.expiration_time ?? p.expiresAt,
  };
}

/** Capture the hold and pay the freelancer. `amount` (less than the full amount) settles for part of it. */
export async function releaseFunds(m: Milestone, note: string, amount = m.amount): Promise<Partial<PaymentState>> {
  // A hold past its honor period may no longer be guaranteed: renew it first, then capture the new one.
  const renewed = await renewHold(m).catch(() => null);
  const authId = renewed?.authorizationId ?? m.payment.authorizationId;
  if (!authId) throw new Error('No PayPal authorization to capture');
  // What the result carries besides the capture: the renewal, and the amount when it's a settlement.
  const extra: Partial<PaymentState> = { ...renewed, ...(amount !== m.amount && { capturedAmount: amount }) };

  if (m.payment.mode === 'simulated') {
    return {
      ...extra,
      captureId: fakeId('CAPTURE'),
      capturedAt: new Date().toISOString(),
      authorizationStatus: 'CAPTURED',
      payoutBatchId: fakeId('PAYOUT'),
      payoutStatus: 'SUCCESS',
    };
  }

  const capture = await captureAuthorization(authId, note, extra.capturedAmount ? { currency_code: m.currency, value: amount } : undefined);
  // Nothing was taken from the buyer: leave the milestone as it is and let the caller show the error.
  if (capture.status === 'DECLINED' || capture.status === 'FAILED') {
    throw new Error(`PayPal ${capture.status.toLowerCase()} the capture (${capture.id}). The money is still on hold.`);
  }
  const result: Partial<PaymentState> = {
    ...extra,
    captureId: capture.id,
    capturedAt: capture.create_time ?? new Date().toISOString(),
    authorizationStatus: 'CAPTURED',
  };

  // Pay out only money that has actually arrived. A pending capture (e.g. an eCheck) would mean
  // paying the freelancer from the platform's own balance.
  if (capture.status !== 'COMPLETED') {
    result.payoutStatus = `HELD: capture is ${capture.status.toLowerCase()}, payout waits for it`;
    return result;
  }

  return { ...result, ...(await sendPayout(m, amount, note)) };
}

/** Pay the freelancer from captured money. A failed payout (e.g. Payouts not enabled on the app) shouldn't undo the capture - record it. */
async function sendPayout(m: Milestone, amount: string, note: string): Promise<Partial<PaymentState>> {
  try {
    const batch = await createPayout({
      milestoneId: m.id,
      receiverEmail: m.freelancer.email,
      amount: (Number(amount) * (1 - PLATFORM_FEE_PCT / 100)).toFixed(2),
      currency: m.currency,
      note,
    });
    return { payoutBatchId: batch.batch_header.payout_batch_id, payoutStatus: batch.batch_header.batch_status };
  } catch (error) {
    return { payoutStatus: `FAILED: ${(error as Error).message.slice(0, 160)}` };
  }
}

/** A held payout, once PayPal reports the capture completed. */
export function payOutHeld(m: Milestone): Promise<Partial<PaymentState>> {
  return sendPayout(m, m.payment.capturedAmount ?? m.amount, 'Work accepted: the capture completed');
}

/** What PayPal captured for this deal and has not refunded yet. */
export function refundable(m: Milestone): number {
  if (!m.payment.captureId) return 0;
  const refunded = (m.payment.refunds ?? []).filter((r) => r.status !== 'FAILED' && r.status !== 'CANCELLED').reduce((sum, r) => sum + Number(r.amount), 0);
  return Math.round((Number(m.payment.capturedAmount ?? m.amount) - refunded) * 100) / 100;
}

/** Return `amount` of the captured money to the client. Throws when PayPal refuses it. */
export async function refundToClient(m: Milestone, amount: number, note: string): Promise<NonNullable<PaymentState['refunds']>[number]> {
  const value = amount.toFixed(2);
  if (m.payment.mode === 'simulated') return { id: fakeId('REFUND'), amount: value, status: 'COMPLETED', at: new Date().toISOString() };
  const refund = await refundCapture(m.payment.captureId!, { currency_code: m.currency, value }, note, (m.payment.refunds ?? []).length + 1);
  if (refund.status === 'FAILED' || refund.status === 'CANCELLED') throw new Error(`PayPal ${refund.status.toLowerCase()} the refund (${refund.id}). Nothing was returned.`);
  return { id: refund.id, amount: value, status: refund.status, at: new Date(refund.create_time ?? Date.now()).toISOString() };
}

export async function cancelFunding(m: Milestone): Promise<Partial<PaymentState>> {
  const authId = m.payment.authorizationId;
  if (authId && m.payment.mode === 'sandbox') {
    try {
      await voidAuthorization(authId);
    } catch (error) {
      // Already expired or voided: there is no hold left to release, so cancelling can go ahead.
      const gone = error instanceof PayPalApiError && error.status === 422 && /EXPIRED|VOIDED/.test(error.message);
      if (!gone) throw error;
    }
  }
  return { voidedAt: new Date().toISOString(), authorizationStatus: authId ? 'VOIDED' : undefined };
}

/** A payout batch starts as PENDING; ask PayPal for its current status. Null when there is nothing to refresh. */
export async function refreshPayoutStatus(m: Milestone): Promise<string | null> {
  const { mode, payoutBatchId, payoutStatus } = m.payment;
  if (mode !== 'sandbox' || !payoutBatchId || !['PENDING', 'PROCESSING'].includes(payoutStatus ?? '')) return null;
  try {
    const batch = await getPayoutBatch(payoutBatchId);
    return batch.batch_header.batch_status !== payoutStatus ? batch.batch_header.batch_status : null;
  } catch {
    return null;
  }
}
