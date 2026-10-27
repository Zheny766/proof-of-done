import { after } from 'next/server';
import { publicMilestone } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { deliverArena, runReview } from '@/lib/escrow/service';
import { allowRequest } from '@/lib/rate-limit';

// "Try to fool it": the visitor's own notes, with the draft menu attached, reviewed live by Claude.
export const POST = handle(async (request: Request) => {
  if (!allowRequest(request, 'arena', 3, 10 * 60_000)) return Response.json({ error: 'Three attempts per 10 minutes. Try again in a bit.' }, { status: 429 });
  const { milestone, reviewId } = await deliverArena(await request.json(), milestoneKey(request));
  after(() => runReview(milestone.id, reviewId));
  return Response.json({ milestone: publicMilestone(milestone), reviewId }, { status: 202 });
});
