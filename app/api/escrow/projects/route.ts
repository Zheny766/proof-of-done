import { publicMilestone } from '@/lib/escrow/access';
import { handle } from '@/lib/escrow/http';
import { createProject } from '@/lib/escrow/service';
import { allowRequest } from '@/lib/rate-limit';

// A project in stages: the creator is the client, and both links work for every stage.
export const POST = handle(async (request: Request) => {
  if (!allowRequest(request, 'create', 30)) return Response.json({ error: 'Too many requests, try again in a minute.' }, { status: 429 });
  const stages = createProject(await request.json());
  const { clientKey, freelancerKey } = stages[0].access!;
  return Response.json({ milestones: stages.map(publicMilestone), clientKey, freelancerKey }, { status: 201 });
});
