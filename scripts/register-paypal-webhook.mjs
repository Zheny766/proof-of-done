// Registers the app's webhook URL with your PayPal sandbox REST app and prints the webhook id for
// PAYPAL_WEBHOOK_ID. Run once per deployment:
//   PAYPAL_CLIENT_ID=... PAYPAL_SECRET=... node scripts/register-paypal-webhook.mjs https://your-app.example/api/paypal/webhook
const url = process.argv[2];
const { PAYPAL_CLIENT_ID: id, PAYPAL_SECRET: secret } = process.env;
if (!url?.startsWith('https://') || !id || !secret) {
  console.error('Usage: PAYPAL_CLIENT_ID=... PAYPAL_SECRET=... node scripts/register-paypal-webhook.mjs https://<host>/api/paypal/webhook');
  process.exit(1);
}
const API = 'https://api-m.sandbox.paypal.com';
const token = await fetch(`${API}/v1/oauth2/token`, {
  method: 'POST',
  headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
}).then((r) => r.json());
const events = [
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.AUTHORIZATION.VOIDED',
  'PAYMENT.PAYOUTSBATCH.SUCCESS',
  'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
  'PAYMENT.PAYOUTS-ITEM.FAILED',
  'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
  'PAYMENT.PAYOUTS-ITEM.RETURNED',
  'PAYMENT.PAYOUTS-ITEM.BLOCKED',
];
const res = await fetch(`${API}/v1/notifications/webhooks`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, event_types: events.map((name) => ({ name })) }),
});
const body = await res.json();
if (!res.ok) {
  console.error(res.status, JSON.stringify(body));
  process.exit(1);
}
console.log(`PAYPAL_WEBHOOK_ID=${body.id}`);
