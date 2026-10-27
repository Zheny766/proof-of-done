import { z } from 'zod';
import { publicMilestone } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { settle } from '@/lib/escrow/service';

// Settling for part of the amount: one party offers, the other accepts (PayPal captures just that) or declines.
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('propose'), amount: z.coerce.number().positive(), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('decline') }),
]);

export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/settlement'>) => {
  const { id } = await ctx.params;
  return Response.json({ milestone: publicMilestone(await settle(id, Body.parse(await request.json()), milestoneKey(request))) });
});
