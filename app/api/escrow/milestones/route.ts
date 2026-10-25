import { handle } from '@/lib/escrow/http';
import { createMilestone } from '@/lib/escrow/service';
import { listMilestones } from '@/lib/escrow/store';

export const GET = handle(async () => Response.json({ milestones: listMilestones() }));

export const POST = handle(async (request: Request) => {
  const milestone = createMilestone(await request.json());
  return Response.json({ milestone }, { status: 201 });
});
