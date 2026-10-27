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

/** Capture the hold and pay the freelancer. `amount` (less than the full amount) settles for part of it. */
export async function releaseFunds(m: Milestone, note: string, amount = m.amount): Promise<Partial<PaymentState>> {
  const authId = m.payment.authorizationId;
  if (!authId) throw new Error('No PayPal authorization to capture');
  const partial = amount !== m.amount ? { capturedAmount: amount } : {};

  if (m.payment.mode === 'simulated') {
    return {
      captureId: fakeId('CAPTURE'),
      capturedAt: new Date().toISOString(),
      authorizationStatus: 'CAPTURED',
      payoutBatchId: fakeId('PAYOUT'),
      payoutStatus: 'SUCCESS',
      ...partial,
    };
  }

  const capture = await captureAuthorization(authId, note, partial.capturedAmount ? { currency_code: m.currency, value: amount } : undefined);
  // Nothing was taken from the buyer: leave the milestone as it is and let the caller show the error.
  if (capture.status === 'DECLINED' || capture.status === 'FAILED') {
    throw new Error(`PayPal ${capture.status.toLowerCase()} the capture (${capture.id}). The money is still on hold.`);
  }
  const result: Partial<PaymentState> = {
    captureId: capture.id,
    capturedAt: capture.create_time ?? new Date().toISOString(),
    authorizationStatus: 'CAPTURED',
    ...partial,
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
