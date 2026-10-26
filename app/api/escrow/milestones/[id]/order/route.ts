import { handle, milestoneKey } from '@/lib/escrow/http';
import { beginFunding } from '@/lib/escrow/service';

// Step 1 of funding: create a PayPal order with intent AUTHORIZE. The PayPal button calls this.
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/order'>) => {
  const { id } = await ctx.params;
  return Response.json(await beginFunding(id, milestoneKey(request)));
});
