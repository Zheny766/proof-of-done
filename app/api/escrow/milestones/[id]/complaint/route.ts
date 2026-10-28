import { publicMilestone } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { afterPayment } from '@/lib/escrow/service';
import { allowRequest } from '@/lib/rate-limit';

// After the payment: the client reports a problem or withdraws it; the freelancer refunds or declines.
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/complaint'>) => {
  if (!allowRequest(request, 'complaint', 20)) return Response.json({ error: 'Too many requests, try again in a minute.' }, { status: 429 });
  const { id } = await ctx.params;
  const milestone = await afterPayment(id, await request.json(), milestoneKey(request));
  return Response.json({ milestone: publicMilestone(milestone) });
});
