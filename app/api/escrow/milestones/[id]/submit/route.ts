import { after } from 'next/server';
import { publicMilestone } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { runReview, submitWork, type IncomingFile } from '@/lib/escrow/service';
import { allowRequest } from '@/lib/rate-limit';

const MAX_FILE = 15 * 1024 * 1024;
const MAX_FILES = 8;

// The freelancer submits work; the AI review runs after the response is sent and the page polls it.
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/submit'>) => {
  const { id } = await ctx.params;
  // Checked before reading the body, so a huge upload is refused instead of buffered.
  if (Number(request.headers.get('content-length') ?? 0) > MAX_FILE * MAX_FILES + 1_000_000) {
    return Response.json({ error: 'Upload too large (8 files, 15 MB each at most).' }, { status: 413 });
  }
  if (!allowRequest(request, 'submit', 10)) return Response.json({ error: 'Too many submissions, try again in a minute.' }, { status: 429 });
  const form = await request.formData();
  const notes = String(form.get('notes') ?? '').slice(0, 10_000);
  const links = String(form.get('links') ?? '')
    .split(/\s+/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l))
    .slice(0, 10);
  const files: IncomingFile[] = [];
  for (const entry of form.getAll('files').slice(0, MAX_FILES)) {
    if (typeof entry === 'string' || entry.size === 0) continue;
    if (entry.size > MAX_FILE) return Response.json({ error: `${entry.name} is larger than 15 MB` }, { status: 400 });
    files.push({ name: entry.name, type: entry.type, bytes: Buffer.from(await entry.arrayBuffer()) });
  }
  const { milestone, reviewId } = submitWork(id, { notes, links, files }, milestoneKey(request));
  after(() => runReview(id, reviewId));
  return Response.json({ milestone: publicMilestone(milestone), reviewId }, { status: 202 });
});
