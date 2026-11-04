import { publicMilestone } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { settle, SettlementInput } from '@/lib/escrow/service';

// Settling for part of the amount: one party offers, the other accepts (PayPal captures just that) or declines.
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/settlement'>) => {
  const { id } = await ctx.params;
  return Response.json({ milestone: publicMilestone(await settle(id, SettlementInput.parse(await request.json()), milestoneKey(request))) });
});
