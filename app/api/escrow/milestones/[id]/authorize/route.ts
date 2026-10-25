import { z } from 'zod';
import { handle } from '@/lib/escrow/http';
import { confirmFunding } from '@/lib/escrow/service';

// Step 2 of funding: after the buyer approves in the PayPal popup, place the hold.
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/authorize'>) => {
  const { id } = await ctx.params;
  const { orderId } = z.object({ orderId: z.string().min(3) }).parse(await request.json());
  return Response.json({ milestone: await confirmFunding(id, orderId) });
});
