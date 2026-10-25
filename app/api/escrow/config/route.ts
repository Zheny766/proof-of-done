import { paymentMode } from '@/lib/escrow/payments';
import { isClaudeConfigured, REVIEW_MODEL } from '@/lib/escrow/reviewer';

// What the browser needs to know. The PayPal client id is public by design; secrets never leave the server.
export async function GET() {
  return Response.json({
    paymentMode: paymentMode(),
    paypalClientId: paymentMode() === 'sandbox' ? process.env.PAYPAL_CLIENT_ID : null,
    reviewer: isClaudeConfigured() ? { engine: 'claude', model: REVIEW_MODEL } : { engine: 'simulated' },
  });
}
