import { publicMilestone } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { changeTerms } from '@/lib/escrow/service';
import { allowRequest } from '@/lib/rate-limit';

// Changing the terms: one side offers new criteria, a lower amount or another deadline; the other accepts or declines.
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/terms'>) => {
  if (!allowRequest(request, 'terms', 20)) return Response.json({ error: 'Too many requests, try again in a minute.' }, { status: 429 });
  const { id } = await ctx.params;
  return Response.json({ milestone: publicMilestone(await changeTerms(id, await request.json(), milestoneKey(request))) });
});
