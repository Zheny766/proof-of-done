import { z } from 'zod';
import { publicMilestone } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { clientDecision } from '@/lib/escrow/service';

// The client always keeps the final say: approve, ask for changes, or cancel (void the hold).
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/decision'>) => {
  const { id } = await ctx.params;
  const { action, note } = z
    .object({ action: z.enum(['approve', 'request_changes', 'cancel']), note: z.string().max(2000).optional() })
    .parse(await request.json());
  return Response.json({ milestone: publicMilestone(await clientDecision(id, action, note ?? '', milestoneKey(request))) });
});
