import { publicJob } from '@/lib/escrow/access';
import { handle } from '@/lib/escrow/http';
import { claimJob } from '@/lib/escrow/service';
import { publicOrigin } from '@/lib/origin';
import { allowRequest } from '@/lib/rate-limit';

// Take a job from the board. The answer carries the taker's private freelancer link, once.
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/jobs/[id]/claim'>) => {
  if (!allowRequest(request, 'claim', 10)) return Response.json({ error: 'Too many requests, try again in a minute.' }, { status: 429 });
  const { id } = await ctx.params;
  const { milestone, freelancerKey } = await claimJob(id, await request.json());
  const origin = publicOrigin(request);
  return Response.json({ job: publicJob(milestone), freelancerKey, link: `${origin}/m/${id}?key=${freelancerKey}` });
});
