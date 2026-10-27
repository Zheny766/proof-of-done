import { publicMilestone, roleFor, viewerMilestone } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { projectStages, readMilestone } from '@/lib/escrow/service';

// Full data for the client or the freelancer (key header), a redacted view for everyone else.
export const GET = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]'>) => {
  const { id } = await ctx.params;
  const milestone = await readMilestone(id);
  if (!milestone) return Response.json({ error: 'Not found' }, { status: 404 });
  const role = roleFor(milestone, milestoneKey(request));
  return Response.json({ milestone: role === 'viewer' ? viewerMilestone(milestone) : publicMilestone(milestone), role, stages: projectStages(milestone) });
});
