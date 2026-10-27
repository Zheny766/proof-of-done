import { z } from 'zod';
import { handle } from '@/lib/escrow/http';
import { startDemo } from '@/lib/escrow/service';
import { allowRequest } from '@/lib/rate-limit';

// "Try it in 60 seconds": a fresh, private demo deal for one scenario. Both keys come back, so the
// visitor can play the client and the freelancer.
export const POST = handle(async (request: Request) => {
  if (!allowRequest(request, 'demo-start', 20)) return Response.json({ error: 'Too many demo deals, try again in a minute.' }, { status: 429 });
  const { scenario } = z.object({ scenario: z.enum(['honest', 'cheater', 'partial', 'arena']) }).parse(await request.json());
  const m = startDemo(scenario);
  return Response.json({ id: m.id, clientKey: m.access!.clientKey, freelancerKey: m.access!.freelancerKey }, { status: 201 });
});
