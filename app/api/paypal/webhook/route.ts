import { isPayPalConfigured, verifyWebhookSignature } from '@/lib/paypal';
import { applyWebhook, type WebhookEvent } from '@/lib/escrow/service';
import { publicOrigin } from '@/lib/origin';

// PayPal webhooks. Nothing is trusted until PayPal itself confirms the signature for our webhook id
// (PAYPAL_WEBHOOK_ID); then the event is applied once to the milestone it belongs to.
export async function POST(request: Request) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId || !isPayPalConfigured()) return Response.json({ error: 'Webhooks are not configured.' }, { status: 503 });
  const length = request.headers.get('content-length');
  if (length === null) return Response.json({ error: 'Send a Content-Length.' }, { status: 411 });
  if (Number(length) > 200_000) return Response.json({ error: 'Too large.' }, { status: 413 });
  let event: WebhookEvent;
  try {
    event = JSON.parse(await request.text());
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  if (!event?.id || !event.event_type) return Response.json({ error: 'Not a PayPal event.' }, { status: 400 });
  const genuine = await verifyWebhookSignature(request.headers, event, webhookId).catch(() => false);
  if (!genuine) return Response.json({ error: 'Signature not verified by PayPal.' }, { status: 401 });
  return Response.json({ result: await applyWebhook(event, publicOrigin(request)) });
}
