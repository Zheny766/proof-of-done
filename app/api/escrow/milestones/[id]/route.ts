import { handle } from '@/lib/escrow/http';
import { getMilestone } from '@/lib/escrow/store';

export const GET = handle(async (_req: Request, ctx: RouteContext<'/api/escrow/milestones/[id]'>) => {
  const { id } = await ctx.params;
  const milestone = getMilestone(id);
  if (!milestone) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ milestone });
});
