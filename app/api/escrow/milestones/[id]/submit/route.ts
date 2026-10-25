import { after } from 'next/server';
import { handle } from '@/lib/escrow/http';
import { runReview, submitWork, type IncomingFile } from '@/lib/escrow/service';

const MAX_FILE = 15 * 1024 * 1024;

// The freelancer submits work; the AI review runs after the response is sent and the page polls it.
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/submit'>) => {
  const { id } = await ctx.params;
  const form = await request.formData();
  const notes = String(form.get('notes') ?? '').slice(0, 10_000);
  const links = String(form.get('links') ?? '')
    .split(/\s+/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l))
    .slice(0, 10);
  const files: IncomingFile[] = [];
  for (const entry of form.getAll('files')) {
    if (typeof entry === 'string' || entry.size === 0) continue;
    if (entry.size > MAX_FILE) return Response.json({ error: `${entry.name} is larger than 15 MB` }, { status: 400 });
    files.push({ name: entry.name, type: entry.type, bytes: Buffer.from(await entry.arrayBuffer()) });
  }
  const { milestone, reviewId } = submitWork(id, { notes, links, files });
  after(() => runReview(id, reviewId));
  return Response.json({ milestone, reviewId }, { status: 202 });
});
