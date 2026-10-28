import 'server-only';
import { ZodError } from 'zod';
import { claudeErrorMessage } from '../ai.ts';
import { PayPalApiError } from '../paypal.ts';
import { isCrossSite } from '../rate-limit.ts';
import { EscrowError } from './service.ts';

const FIELD: Record<string, string> = {
  title: 'the title',
  description: 'the details',
  criteria: 'acceptance criteria',
  amount: 'the amount',
  clientName: 'the client name',
  clientEmail: 'the client email',
  freelancerName: 'the freelancer name',
  freelancerEmail: "the freelancer's PayPal email",
  payoutEmail: 'the PayPal email',
  name: 'your name',
  notes: 'the notes',
  note: 'the note',
  stages: 'stages',
  releaseThreshold: 'the release threshold',
  objectionHours: 'the objection window',
};

// "Stage 1, criterion 2 needs at least 3 characters." rather than "stages.0.criteria.1: Too small: ...".
// Agents get the same sentence, which names the field just as well.
function issueText(issue: ZodError['issues'][number]): string {
  const parts: string[] = [];
  for (let k = 0; k < issue.path.length; k++) {
    const p = String(issue.path[k]);
    const next = issue.path[k + 1];
    if (typeof next === 'number' && (p === 'criteria' || p === 'stages')) {
      parts.push(`${p === 'criteria' ? 'criterion' : 'stage'} ${next + 1}`);
      k++;
    } else parts.push(FIELD[p] ?? p);
  }
  const where = parts.join(', ') || 'the input';
  const i = issue as { code: string; origin?: string; minimum?: number | bigint; maximum?: number | bigint; format?: string; expected?: string };
  const what =
    i.code === 'too_small'
      ? i.origin === 'string' ? `needs at least ${i.minimum} characters` : i.origin === 'array' ? `: add at least ${i.minimum}` : `must be at least ${i.minimum}`
      : i.code === 'too_big'
        ? i.origin === 'string' ? `can be at most ${i.maximum} characters` : i.origin === 'array' ? `: ${i.maximum} at most` : `must be at most ${i.maximum}`
        : i.code === 'invalid_format' && i.format === 'email'
          ? 'is not a valid email address'
          : i.code === 'invalid_type'
            ? i.expected === 'number' ? 'must be a number' : 'is missing'
            : `: ${issue.message.charAt(0).toLowerCase()}${issue.message.slice(1)}`;
  const text = `${where}${what.startsWith(':') ? '' : ' '}${what}.`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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
      if (error instanceof ZodError) return Response.json({ error: error.issues.slice(0, 3).map(issueText).join(' ') }, { status: 400 });
      if (error instanceof EscrowError) return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof PayPalApiError) {
        console.error('[paypal]', error.message);
        // Trying again is safe: each money call carries an idempotency key, so PayPal won't do it twice.
        if (error.status === 0) return Response.json({ error: 'PayPal did not answer. Please try again in a moment.' }, { status: 504 });
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
