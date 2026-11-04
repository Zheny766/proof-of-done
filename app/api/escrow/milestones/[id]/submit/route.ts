import { after } from 'next/server';
import { publicMilestone } from '@/lib/escrow/access';
import { handle, milestoneKey } from '@/lib/escrow/http';
import { runReview, submitWork, type IncomingFile } from '@/lib/escrow/service';
import { allowRequest } from '@/lib/rate-limit';

const MAX_FILE = 15 * 1024 * 1024;
const MAX_FILES = 8;
// All files of one delivery together; the hosted demo runs on 512 MB of memory.
const MAX_TOTAL = Number(process.env.POD_MAX_UPLOAD_MB ?? 40) * 1024 * 1024;

// The freelancer submits work; the AI review runs after the response is sent and the page polls it.
export const POST = handle(async (request: Request, ctx: RouteContext<'/api/escrow/milestones/[id]/submit'>) => {
  const { id } = await ctx.params;
  if (!allowRequest(request, 'submit', 10)) return Response.json({ error: 'Too many submissions, try again in a minute.' }, { status: 429 });
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: 'Send the delivery as a form (multipart/form-data): notes, links and files.' }, { status: 400 });
  const notes = String(form.get('notes') ?? '').slice(0, 10_000);
  const links = String(form.get('links') ?? '')
    .split(/\s+/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l) && l.length <= 2048)
    .slice(0, 10);
  const files: IncomingFile[] = [];
  for (const entry of form.getAll('files').slice(0, MAX_FILES)) {
    if (typeof entry === 'string' || entry.size === 0) continue;
    if (entry.size > MAX_FILE) return Response.json({ error: `${entry.name} is larger than 15 MB` }, { status: 400 });
    files.push({ name: entry.name, type: entry.type, bytes: Buffer.from(await entry.arrayBuffer()) });
  }
  const payoutEmail = String(form.get('payoutEmail') ?? '').trim() || undefined;
  const { milestone, reviewId } = await submitWork(id, { notes, links, files, payoutEmail }, milestoneKey(request));
  after(() => runReview(id, reviewId));
  return Response.json({ milestone: publicMilestone(milestone), reviewId }, { status: 202 });
  // The size is checked (by handle) before the body is read, so a huge upload is refused, not buffered.
}, { maxBytes: MAX_TOTAL + 1_000_000 });
