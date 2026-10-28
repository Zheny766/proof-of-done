import { z } from 'zod';
import { publicMilestone } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { answerDispute } from '@/lib/escrow/service';
import { publicOrigin } from '@/lib/origin';
import { allowRequest } from '@/lib/rate-limit';

// The freelancer sends the deal's evidence to PayPal for a buyer's dispute (it also goes by itself
// when the dispute arrives, if PayPal takes evidence then).
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/dispute'>) => {
  if (!allowRequest(request, 'dispute', 10)) return Response.json({ error: 'Too many requests, try again in a minute.' }, { status: 429 });
  const { id } = await ctx.params;
  const { disputeId } = z.object({ disputeId: z.string().trim().min(3).max(64) }).parse(await request.json());
  return Response.json({ milestone: publicMilestone(await answerDispute(id, disputeId, publicOrigin(request), milestoneKey(request))) });
});
