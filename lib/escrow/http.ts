import 'server-only';
import { ZodError } from 'zod';
import { claudeErrorMessage } from '@/lib/ai';
import { PayPalApiError } from '@/lib/paypal';
import { isCrossSite } from '@/lib/rate-limit';
import { EscrowError } from './service';

/** The caller's milestone key (from their client or freelancer link), sent by the browser as a header. */
export const milestoneKey = (request: Request) => request.headers.get('x-milestone-key');

/** Wrap a route handler so domain, validation and PayPal errors become clean JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const request = args[0];
    if (request instanceof Request && request.method !== 'GET' && isCrossSite(request)) {
      return Response.json({ error: 'Cross-site request refused.' }, { status: 403 });
    }
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof SyntaxError) return Response.json({ error: 'The request body must be valid JSON.' }, { status: 400 });
      if (error instanceof ZodError) {
        const msg = error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
        return Response.json({ error: msg }, { status: 400 });
      }
      if (error instanceof EscrowError) return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof PayPalApiError) {
        console.error('[paypal]', error.message);
        return Response.json({ error: `PayPal error (${error.status}). ${error.message.slice(0, 200)}` }, { status: 502 });
      }
      const claude = claudeErrorMessage(error);
      if (claude) {
        console.error('[claude]', claude);
        return Response.json({ error: `Claude is unavailable right now: ${claude.slice(0, 200)}` }, { status: 502 });
      }
      // The details (stack, file paths) go to the server log, not to the browser.
      console.error('[escrow]', error);
      return Response.json({ error: 'Something went wrong on the server. Please try again.' }, { status: 500 });
    }
  };
}
