import { roleFor } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { dealRecord } from '@/lib/escrow/record';
import { readMilestone } from '@/lib/escrow/service';

// The deal's whole record, for the client or the freelancer, as a JSON download (see lib/escrow/record.ts).
export const GET = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/record'>) => {
  const { id } = await ctx.params;
  const m = await readMilestone(id);
  if (!m) return Response.json({ error: 'Not found' }, { status: 404 });
  const role = roleFor(m, milestoneKey(request));
  if (role === 'viewer') return Response.json({ error: 'Only the client or the freelancer can download the record.' }, { status: 403 });
  const record = dealRecord(m, role, new URL(request.url).origin);
  return new Response(JSON.stringify(record, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="proof-of-done-${m.id}.json"` },
  });
});
