import { publicMilestone, viewerMilestone } from '@/lib/escrow/access';
import { handle } from '@/lib/escrow/http';
import { createMilestone } from '@/lib/escrow/service';
import { listMilestones } from '@/lib/escrow/store';
import { allowRequest, withinDailyBudget } from '@/lib/rate-limit';
import { criterionHint } from '@/lib/escrow/criteria-lint';

export const GET = handle(async () => Response.json({ milestones: listMilestones().filter((m) => !m.demo).map(viewerMilestone) }));

// The creator is the client: they get their own key and the link to send to the freelancer.
export const POST = handle(async (request: Request) => {
  if (!allowRequest(request, 'create', 30)) return Response.json({ error: 'Too many requests, try again in a minute.' }, { status: 429 });
  // Deals are kept on disk: a day's cap stops a script from filling the store with them.
  if (!withinDailyBudget('create', Number(process.env.POD_CREATE_DAILY ?? 500))) return Response.json({ error: 'This server has taken all the new deals it accepts today. Try again tomorrow.' }, { status: 429 });
  const milestone = createMilestone(await request.json());
  return Response.json(
    // A job on the open board has no freelancer yet: whoever takes it gets their own key.
    {
      milestone: publicMilestone(milestone),
      clientKey: milestone.access!.clientKey,
      freelancerKey: milestone.board ? undefined : milestone.access!.freelancerKey,
      // Criteria the reviewer may not be able to check, for an agent that posted the job to fix.
      criteriaHints: milestone.criteria.flatMap((c) => {
        const h = criterionHint(c.text);
        return h ? [`"${c.text}": "${h.word}" ${h.hint}`] : [];
      }),
    },
    { status: 201 },
  );
});
