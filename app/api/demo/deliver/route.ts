import { after } from 'next/server';
import { z } from 'zod';
import { publicMilestone } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { deliverDemo, runReview } from '@/lib/escrow/service';

// The freelancer of a demo deal hands in the prepared delivery; its review replays a real Claude run.
export const POST = handle(async (request: Request) => {
  const { id } = z.object({ id: z.string().min(3).max(40) }).parse(await request.json());
  const { milestone, reviewId } = await deliverDemo(id, milestoneKey(request));
  after(() => runReview(id, reviewId));
  return Response.json({ milestone: publicMilestone(milestone), reviewId }, { status: 202 });
});
