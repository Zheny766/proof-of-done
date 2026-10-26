import { publicMilestone, viewerMilestone } from '@/lib/escrow/access';
import { handle } from '@/lib/escrow/http';
import { createMilestone } from '@/lib/escrow/service';
import { listMilestones } from '@/lib/escrow/store';
import { allowRequest } from '@/lib/rate-limit';

export const GET = handle(async () => Response.json({ milestones: listMilestones().map(viewerMilestone) }));

// The creator is the client: they get their own key and the link to send to the freelancer.
export const POST = handle(async (request: Request) => {
  if (!allowRequest(request, 'create', 30)) return Response.json({ error: 'Too many requests, try again in a minute.' }, { status: 429 });
  const milestone = createMilestone(await request.json());
  return Response.json(
    { milestone: publicMilestone(milestone), clientKey: milestone.access!.clientKey, freelancerKey: milestone.access!.freelancerKey },
    { status: 201 },
  );
});
