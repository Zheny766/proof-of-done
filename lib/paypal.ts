// PayPal REST calls (sandbox): OAuth, Orders v2 with intent AUTHORIZE, capture/void, Payouts.
// Plain fetch, no SDK. Server-side only - it reads the client secret.

const BASE_URL = 'https://api-m.sandbox.paypal.com';
const MAX_ATTEMPTS = 4;

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
  });
  if (!res.ok) throw new PayPalApiError(res.status, '/v1/oauth2/token', await res.text());

  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early so a request in flight never carries an expired token.
  cachedToken = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...(method === 'POST' && { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        // Same key on a retry -> PayPal replays the first result instead of charging twice.
        ...(idempotencyKey && { 'PayPal-Request-Id': idempotencyKey }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
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
          description: `Milestone: ${input.title}`.slice(0, 127),
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
