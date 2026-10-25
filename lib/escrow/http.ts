import 'server-only';
import { ZodError } from 'zod';
import { PayPalApiError } from '@/lib/paypal';
import { EscrowError } from './service';

/** Wrap a route handler so domain, validation and PayPal errors become clean JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ZodError) {
        const msg = error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
        return Response.json({ error: msg }, { status: 400 });
      }
      if (error instanceof EscrowError) return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof PayPalApiError) {
        console.error('[paypal]', error.message);
        return Response.json({ error: `PayPal error (${error.status}). ${error.message.slice(0, 200)}` }, { status: 502 });
      }
      console.error('[escrow]', error);
      return Response.json({ error: (error as Error).message ?? 'Unexpected error' }, { status: 500 });
    }
  };
}
