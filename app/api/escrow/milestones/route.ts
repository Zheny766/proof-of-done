import { publicMilestone } from '@/lib/escrow/access';
import { handle } from '@/lib/escrow/http';
import { createMilestone } from '@/lib/escrow/service';
import { listMilestones } from '@/lib/escrow/store';

export const GET = handle(async () => Response.json({ milestones: listMilestones().map(publicMilestone) }));

// The creator is the client: they get their own key and the link to send to the freelancer.
export const POST = handle(async (request: Request) => {
  const milestone = createMilestone(await request.json());
  return Response.json(
    { milestone: publicMilestone(milestone), clientKey: milestone.access!.clientKey, freelancerKey: milestone.access!.freelancerKey },
    { status: 201 },
  );
});
