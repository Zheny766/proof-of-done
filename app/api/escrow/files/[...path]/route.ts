import fs from 'node:fs';
import path from 'node:path';
import { roleFor } from '@/lib/escrow/access';
import { getMilestone, UPLOAD_DIR } from '@/lib/escrow/store';

const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
const notFound = () => new Response('Not found', { status: 404 });

// Submission attachments, for the client and the freelancer only (?key= from their link; an <img>
// can't send a header). Files are served by their recorded attachment entry, with the type that was
// sniffed at upload, never by a path or extension the request made up.
export async function GET(request: Request, ctx: RouteContext<'/api/escrow/files/[...path]'>) {
  const { path: parts } = await ctx.params;
  const milestone = getMilestone(parts[0] ?? '');
  if (!milestone || roleFor(milestone, new URL(request.url).searchParams.get('key')) === 'viewer') return notFound();

  const rel = path.join(...parts);
  const attachment = milestone.submissions.flatMap((s) => s.attachments).find((a) => a.file === rel);
  const abs = attachment && path.resolve(UPLOAD_DIR, attachment.file);
  if (!attachment || !abs || !abs.startsWith(path.resolve(UPLOAD_DIR) + path.sep) || !fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) {
    return notFound();
  }
  // A link planted in the uploads folder must not lead outside it.
  if (!fs.realpathSync(abs).startsWith(fs.realpathSync(UPLOAD_DIR) + path.sep)) return notFound();

  const inline = INLINE.has(attachment.mime);
  return new Response(fs.readFileSync(abs), {
    headers: {
      'Content-Type': inline ? attachment.mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      // Uploads are untrusted: don't let the browser sniff them into something executable.
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
