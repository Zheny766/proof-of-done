import { z } from 'zod';
import { handle } from '@/lib/escrow/http';
import { draftCriteria } from '@/lib/escrow/service';

// Claude drafts objectively checkable acceptance criteria from a plain-language job description.
export const POST = handle(async (request: Request) => {
  const { title, description } = z
    .object({ title: z.string().trim().min(3).max(120), description: z.string().max(4000).default('') })
    .parse(await request.json());
  return Response.json({ criteria: await draftCriteria(title, description) });
});
