import { handle } from '@/lib/escrow/http';
import { syncWithPayPal } from '@/lib/escrow/service';
import { allowRequest } from '@/lib/rate-limit';

// Bring one deal up to date with PayPal now (what opening its page does): renew a hold past its 3-day
// guarantee, refresh a pending payout, pay out when the objection window has closed. The dashboard
// assistant's sync_with_paypal tool calls it. Needs no key: it only does what any visit would.
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/sync'>) => {
  if (!allowRequest(request, 'sync', 20)) return Response.json({ error: 'Too many requests, try again in a minute.' }, { status: 429 });
  const { id } = await ctx.params;
  return Response.json(await syncWithPayPal(id));
});
