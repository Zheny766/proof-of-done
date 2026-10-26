// In-memory and per process, which is enough to stop one client from burning through API credits.

const hits = new Map<string, number[]>();

export function allowRequest(request: Request, bucket: string, limit: number, windowMs = 60_000): boolean {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'local';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  if (hits.size > 10_000) hits.clear();
  hits.set(key, recent);
  return true;
}

/** Browsers send Sec-Fetch-Site; refuse writes that another site triggered (CSRF). */
export const isCrossSite = (request: Request) => ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? '');
