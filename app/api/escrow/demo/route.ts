import { z } from 'zod';
import { handle } from '@/lib/escrow/http';
import { hasDemoHistory, seedDemo } from '@/lib/escrow/demo';
import { deleteAll, listMilestones } from '@/lib/escrow/store';
import { allowRequest } from '@/lib/rate-limit';

// POST { reset?: boolean } - adds labelled demo milestones (simulated payments) for the dashboard.
// Wiping existing data is only allowed in development, or when POD_ALLOW_RESET=1.
export const POST = handle(async (request: Request) => {
  if (!allowRequest(request, 'demo', 3)) return Response.json({ error: 'Demo data was just added - try again in a minute.' }, { status: 429 });
  // Any body that isn't `{ reset: true }` (none, null, junk) just loads the history.
  const body = z.object({ reset: z.boolean().optional() }).catch({}).parse(await request.json().catch(() => ({})));
  if (body.reset) {
    if (process.env.NODE_ENV === 'production' && process.env.POD_ALLOW_RESET !== '1') {
      return Response.json({ error: 'Reset is disabled in production.' }, { status: 403 });
    }
    deleteAll();
  } else if (hasDemoHistory()) {
    return Response.json({ error: 'The demo history is already loaded.' }, { status: 409 });
  }
  const added = seedDemo(30);
  return Response.json({ added, total: listMilestones().length });
});
