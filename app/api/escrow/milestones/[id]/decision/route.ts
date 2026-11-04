import { publicMilestone } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { clientDecision, DecisionInput } from '@/lib/escrow/service';

// The client always keeps the final say: approve, ask for changes, or cancel (void the hold).
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/decision'>) => {
  const { id } = await ctx.params;
  const { action, note } = DecisionInput.parse(await request.json());
  return Response.json({ milestone: publicMilestone(await clientDecision(id, action, note ?? '', milestoneKey(request))) });
});
