// In-memory and per process, which is enough to stop one client from burning through API credits.
//
// The per-IP count trusts X-Forwarded-For, which a client can set itself when nothing in front of
// the app overwrites it (Next only fills it in when it's missing). So every bucket also has a
// shared cap of 4x the per-IP limit: rotating fake IPs can't push the total past it.

const hits = new Map<string, number[]>();

function take(key: string, limit: number, windowMs: number, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function allowRequest(request: Request, bucket: string, limit: number, windowMs = 60_000): boolean {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'local';
  const now = Date.now();
  if (hits.size > 10_000) {
    // Drop per-IP history but keep the shared caps.
    for (const key of hits.keys()) if (!key.endsWith(':*')) hits.delete(key);
  }
  if (!take(`${bucket}:*`, limit * 4, windowMs, now)) return false;
  return take(`${bucket}:${ip}`, limit, windowMs, now);
}

/** Browsers send Sec-Fetch-Site; refuse writes that another site triggered (CSRF). */
export const isCrossSite = (request: Request) => ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? '');
