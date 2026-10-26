// The reviewer opens links from submissions, i.e. URLs chosen by whoever submitted the work.
// Only public hosts are allowed, and redirects are followed by hand so a public URL can't bounce
// us onto localhost or a cloud metadata address.

import dns from 'node:dns/promises';
import net from 'node:net';

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, incl. 169.254.169.254
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http(s) links can be opened');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (addresses.some(isPrivateIp)) throw new Error('private or local addresses are not allowed');
}

export async function fetchPublic(start: URL, init: RequestInit = {}): Promise<{ res: Response; url: URL }> {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { ...init, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    return { res, url };
  }
  throw new Error('too many redirects');
}

/** Body as text, reading at most `maxBytes` (a link can point at a huge file). */
export async function readText(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8');
}
