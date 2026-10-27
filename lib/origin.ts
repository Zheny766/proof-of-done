// The address people reach this server at, for links handed out in API answers. Behind a proxy
// (Render) the request URL can be the internal one.
export function publicOrigin(request: Request): string {
  const configured = process.env.POD_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host');
  if (host) return `${request.headers.get('x-forwarded-proto') ?? 'https'}://${host}`;
  return new URL(request.url).origin;
}
