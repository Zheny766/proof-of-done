import { z } from 'zod';
import { handle } from '@/lib/escrow/http';
import { clientDecision } from '@/lib/escrow/service';

// The client always keeps the final say: approve, ask for changes, or cancel (void the hold).
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/decision'>) => {
  const { id } = await ctx.params;
  const { action, note } = z
    .object({ action: z.enum(['approve', 'request_changes', 'cancel']), note: z.string().max(2000).optional() })
    .parse(await request.json());
  return Response.json({ milestone: await clientDecision(id, action, note) });
});
