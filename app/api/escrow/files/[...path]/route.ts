import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from '@/lib/escrow/store';

// Serves submission attachments for previews. Paths are confined to the uploads directory.
export async function GET(_req: Request, ctx: RouteContext<'/api/escrow/files/[...path]'>) {
  const { path: parts } = await ctx.params;
  const abs = path.resolve(UPLOAD_DIR, ...parts);
  if (!abs.startsWith(path.resolve(UPLOAD_DIR) + path.sep) || !fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) {
    return new Response('Not found', { status: 404 });
  }
  const ext = path.extname(abs).toLowerCase();
  const type =
    { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' }[ext] ??
    'application/octet-stream';
  return new Response(fs.readFileSync(abs), {
    headers: {
      'Content-Type': type,
      'Content-Disposition': type.startsWith('image/') || type === 'application/pdf' ? 'inline' : 'attachment',
      // Uploads are untrusted: don't let the browser sniff a ".png" into HTML.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
