import { handle } from '@/lib/escrow/http';
import { readMilestone } from '@/lib/escrow/service';

export const GET = handle(async (_req: Request, ctx: RouteContext<'/api/escrow/milestones/[id]'>) => {
  const { id } = await ctx.params;
  const milestone = await readMilestone(id);
  if (!milestone) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ milestone });
});
