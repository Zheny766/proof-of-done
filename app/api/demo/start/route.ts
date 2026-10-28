import { z } from 'zod';
import { handle } from '@/lib/escrow/http';
import { startDemo } from '@/lib/escrow/service';
import { allowRequest } from '@/lib/rate-limit';

// "Try it in 60 seconds": a fresh, private demo deal for one scenario. Both keys come back, so the
// visitor can play the client and the freelancer.
export const POST = handle(async (request: Request) => {
  if (!allowRequest(request, 'demo-start', 20)) return Response.json({ error: 'Too many demo deals, try again in a minute.' }, { status: 429 });
  const { scenario } = z.object({ scenario: z.enum(['honest', 'cheater', 'partial', 'code', 'arena', 'project']) }).parse(await request.json());
  const m = startDemo(scenario);
  // A project's stages share the two keys: the visitor's browser keeps them for every stage.
  return Response.json({ id: m.id, clientKey: m.access!.clientKey, freelancerKey: m.access!.freelancerKey, stageIds: m.project?.stageIds ?? [m.id] }, { status: 201 });
});
