// PayPal REST calls (sandbox): OAuth, Orders v2 with intent AUTHORIZE, capture/void, Payouts.
// Plain fetch, no SDK. Server-side only - it reads the client secret.

const BASE_URL = 'https://api-m.sandbox.paypal.com';
const MAX_ATTEMPTS = 4;
// A call that hangs would hold the deal's queue (and the person's click) forever.
const TIMEOUT_MS = 30_000;

export class PayPalApiError extends Error {
  readonly status: number;
  readonly path: string;
  constructor(status: number, path: string, body: string) {
    super(`PayPal ${status} on ${path}: ${body.slice(0, 300)}`);
    this.name = 'PayPalApiError';
    this.status = status;
    this.path = path;
  }
}

let cachedToken: { value: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const { PAYPAL_CLIENT_ID: id, PAYPAL_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_SECRET must be set (see .env.local)');

  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new PayPalApiError(res.status, '/v1/oauth2/token', await res.text());

  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early so a request in flight never carries an expired token.
  cachedToken = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

/** One PayPal REST call, as recorded in a milestone's ledger. */
export type PayPalCall = { at: string; method: string; path: string; status: number; ms: number; requestId?: string; debugId?: string };
let callListener: ((call: PayPalCall) => void) | undefined;
/** Called after every PayPal request (not the token requests), retries included. */
export const onPayPalCall = (listener: (call: PayPalCall) => void) => void (callListener = listener);

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const token = await accessToken();
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(method === 'POST' && { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
          // Same key on a retry -> PayPal replays the first result instead of charging twice.
          ...(idempotencyKey && { 'PayPal-Request-Id': idempotencyKey }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // No answer at all (network, timeout). Sending it again is safe for the same reason as above.
      callListener?.({ at: new Date(started).toISOString(), method, path, status: 0, ms: Date.now() - started, requestId: idempotencyKey });
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 250));
        continue;
      }
      throw new PayPalApiError(0, path, `no answer (${(error as Error).message})`);
    }
    callListener?.({
      at: new Date(started).toISOString(),
      method,
      path,
      status: res.status,
      ms: Date.now() - started,
      requestId: idempotencyKey,
      debugId: res.headers.get('paypal-debug-id') ?? undefined,
    });
    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    }
    // Expired or revoked token: get a new one and try once more.
    if (res.status === 401 && attempt === 1) {
      cachedToken = undefined;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 250));
      continue;
    }
    throw new PayPalApiError(res.status, path, await res.text());
  }
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>('POST', path, body, idempotencyKey);

export const isPayPalConfigured = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);

/** The cached OAuth token, for PayPal's Agent Toolkit (lib/escrow/paypal-toolkit.ts). */
export const paypalAccessToken = () => accessToken();

export type Money = { value: string; currency_code: string };

export type Authorization = {
  id: string;
  status: 'CREATED' | 'CAPTURED' | 'DENIED' | 'PARTIALLY_CAPTURED' | 'VOIDED' | 'PENDING';
  amount: Money;
  expiration_time?: string;
  create_time?: string;
};

export type Capture = {
  id: string;
  status: 'COMPLETED' | 'DECLINED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'REFUNDED' | 'FAILED';
  amount: Money;
  create_time?: string;
};

export type Order = {
  id: string;
  status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';
  intent: 'CAPTURE' | 'AUTHORIZE';
  payer?: { email_address?: string; payer_id?: string };
  purchase_units?: {
    reference_id?: string;
    custom_id?: string;
    amount: Money;
    payments?: { authorizations?: Authorization[]; captures?: Capture[] };
  }[];
};

/** Create an order with intent AUTHORIZE for one milestone. */
export function createAuthorizeOrder(input: {
  milestoneId: string;
  title: string;
  amount: string;
  currency: string;
}): Promise<Order> {
  return post<Order>(
    '/v2/checkout/orders',
    {
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: input.milestoneId,
          custom_id: input.milestoneId,
          // What the buyer reads in PayPal's window and in their account's activity.
          description: `Proof of Done escrow: ${input.title}`.slice(0, 127),
          amount: { currency_code: input.currency, value: input.amount },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Proof of Done',
            user_action: 'CONTINUE',
            shipping_preference: 'NO_SHIPPING',
          },
        },
      },
    },
    // One order per milestone attempt; a retry with the same key returns the same order.
    `order-${input.milestoneId}-${Date.now().toString(36)}`,
  );
}

/** After the buyer approves, place the hold. Returns the order with its authorization. */
export function authorizeOrder(orderId: string): Promise<Order> {
  return post<Order>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, `auth-${orderId}`);
}

/**
 * Move the held money: all of it, or `amount` for a settlement. `final_capture` closes the
 * authorization, so nothing more can be captured and the rest of the hold goes back to the buyer.
 */
export function captureAuthorization(authorizationId: string, note: string, amount?: Money): Promise<Capture> {
  return post<Capture>(
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    { ...(amount && { amount }), final_capture: true, note_to_payer: note.slice(0, 255) },
    `capture-${authorizationId}`,
  );
}

/**
 * A fresh 3-day honor period for a hold whose first one has passed. PayPal allows this once, from
 * day 4 up to day 29 of the authorization; the answer is a new authorization with a new id.
 */
export function reauthorizeAuthorization(authorizationId: string, amount: Money): Promise<Authorization> {
  return post<Authorization>(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/reauthorize`, { amount }, `reauth-${authorizationId}`);
}

export type Refund = { id: string; status: 'CANCELLED' | 'FAILED' | 'PENDING' | 'COMPLETED'; amount?: Money; create_time?: string };

/**
 * Give the client back money from a completed capture (all of it, or part). `n` numbers the refunds
 * on one capture, so a retry of the same refund replays it and a second refund is a new one.
 */
export function refundCapture(captureId: string, amount: Money, note: string, n: number): Promise<Refund> {
  return post<Refund>(
    `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    { amount, note_to_payer: note.slice(0, 255) },
    `refund-${captureId}-${n}`,
  );
}

/** Release the hold without charging anything. */
export function voidAuthorization(authorizationId: string): Promise<unknown> {
  return post<unknown>(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, undefined, `void-${authorizationId}`);
}

export type PayoutBatch = { batch_header: { payout_batch_id: string; batch_status: string } };

/** Pay the freelancer from the platform balance (Payouts API). */
export function createPayout(input: {
  milestoneId: string;
  receiverEmail: string;
  amount: string;
  currency: string;
  note: string;
}): Promise<PayoutBatch> {
  return post<PayoutBatch>(
    '/v1/payments/payouts',
    {
      sender_batch_header: {
        sender_batch_id: `pod-${input.milestoneId}`,
        email_subject: 'You got paid: work verified by Proof of Done',
        email_message: input.note.slice(0, 1000),
      },
      items: [
        {
          recipient_type: 'EMAIL',
          receiver: input.receiverEmail,
          amount: { value: input.amount, currency: input.currency },
          note: input.note.slice(0, 4000),
          sender_item_id: input.milestoneId,
        },
      ],
    },
    `payout-${input.milestoneId}`,
  );
}

/** Current status of a payout batch (PENDING -> SUCCESS once the money reaches the receiver). */
export function getPayoutBatch(batchId: string): Promise<PayoutBatch> {
  return get<PayoutBatch>(`/v1/payments/payouts/${encodeURIComponent(batchId)}`);
}

/**
 * Ask PayPal whether a webhook delivery really came from PayPal, for our webhook. `event` must be the
 * delivery's JSON body exactly as received.
 */
export async function verifyWebhookSignature(headers: Headers, event: unknown, webhookId: string): Promise<boolean> {
  const h = (name: string) => headers.get(name) ?? '';
  const res = await post<{ verification_status?: string }>('/v1/notifications/verify-webhook-signature', {
    auth_algo: h('paypal-auth-algo'),
    cert_url: h('paypal-cert-url'),
    transmission_id: h('paypal-transmission-id'),
    transmission_sig: h('paypal-transmission-sig'),
    transmission_time: h('paypal-transmission-time'),
    webhook_id: webhookId,
    webhook_event: event,
  });
  return res.verification_status === 'SUCCESS';
}
