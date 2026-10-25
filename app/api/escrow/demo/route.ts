import { handle } from '@/lib/escrow/http';
import { seedDemo } from '@/lib/escrow/demo';
import { deleteAll, listMilestones } from '@/lib/escrow/store';

// POST { reset?: boolean } - adds labelled demo milestones (simulated payments) for the dashboard.
// Wiping existing data is only allowed in development, or when POD_ALLOW_RESET=1.
export const POST = handle(async (request: Request) => {
  const body = (await request.json().catch(() => ({}))) as { reset?: boolean };
  if (body.reset) {
    if (process.env.NODE_ENV === 'production' && process.env.POD_ALLOW_RESET !== '1') {
      return Response.json({ error: 'Reset is disabled in production.' }, { status: 403 });
    }
    deleteAll();
  }
  const added = seedDemo(30);
  return Response.json({ added, total: listMilestones().length });
});
