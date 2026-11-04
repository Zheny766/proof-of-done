import { roleFor } from '@/lib/escrow/access';
import { publicOrigin } from '@/lib/origin';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { evidencePdf } from '@/lib/escrow/disputes';
import { dealRecord } from '@/lib/escrow/record';
import { readMilestone } from '@/lib/escrow/service';
import { paypalHoldsFingerprint } from '@/lib/escrow/payments';

// The deal's whole record, for the client or the freelancer, as a JSON download (see lib/escrow/record.ts),
// or with ?format=pdf as the PDF that goes to PayPal in a dispute (lib/escrow/disputes.ts).
export const GET = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/record'>) => {
  const { id } = await ctx.params;
  const m = await readMilestone(id);
  if (!m) return Response.json({ error: 'Deal not found.' }, { status: 404 });
  const role = roleFor(m, milestoneKey(request));
  if (role === 'viewer') return Response.json({ error: 'Only the client or the freelancer can download the record.' }, { status: 403 });
  // The certificate link in the file must be the public one, not the address behind the host's proxy.
  if (new URL(request.url).searchParams.get('format') === 'pdf') {
    return new Response(new Uint8Array(evidencePdf(m, publicOrigin(request))), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="proof-of-done-${m.id}.pdf"` },
    });
  }
  // Asked of PayPal itself, so the anchor isn't only this server's word.
  const record = { ...dealRecord(m, role, publicOrigin(request)), paypalConfirmsFingerprint: await paypalHoldsFingerprint(m) };
  return new Response(JSON.stringify(record, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="proof-of-done-${m.id}.json"` },
  });
});
