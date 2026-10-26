import { z } from 'zod';
import { handle } from '@/lib/escrow/http';
import { draftCriteria } from '@/lib/escrow/service';
import { allowRequest } from '@/lib/rate-limit';

// Claude drafts objectively checkable acceptance criteria from a plain-language job description.
export const POST = handle(async (request: Request) => {
  if (!allowRequest(request, 'criteria', 10)) return Response.json({ error: 'Too many requests, try again in a minute.' }, { status: 429 });
  const { title, description } = z
    .object({ title: z.string().trim().min(3).max(120), description: z.string().max(4000).default('') })
    .parse(await request.json());
  return Response.json({ criteria: await draftCriteria(title, description) });
});
