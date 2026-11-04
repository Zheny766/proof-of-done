// The address people reach this server at, for links handed out in API answers. Behind a proxy
// (Render) the request URL can be the internal one.
export function publicOrigin(request: Request): string {
  const configured = process.env.POD_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host');
  if (host) return `${request.headers.get('x-forwarded-proto') ?? 'https'}://${host}`;
  return new URL(request.url).origin;
}

/**
 * Where this server may call itself (the hosted MCP tools do, through the public API). Never taken
 * from a Host or X-Forwarded-Host header a client chose, which could point the calls at an internal
 * address: the configured public URL, or, with none configured, the request's own address only when
 * it is this machine.
 */
export function selfOrigin(request: Request): string | null {
  const configured = process.env.POD_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/$/, '');
  const url = new URL(request.url);
  // Next fills X-Forwarded-Host in with the Host when it's missing; a different one came from the client.
  const forwarded = request.headers.get('x-forwarded-host');
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && (!forwarded || forwarded === url.host) ? url.origin : null;
}
