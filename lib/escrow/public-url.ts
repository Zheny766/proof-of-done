// The reviewer opens links from submissions, i.e. URLs chosen by whoever submitted the work.
// Only public hosts are allowed. The address is checked inside the connection's own DNS lookup, so
// the request goes to exactly the address that passed the check (a host can't resolve to something
// public for the check and to 127.0.0.1 for the request), and redirects are followed by hand so
// every hop is checked again.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
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
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) || // 192.0.0.0/24 protocol assignments, 192.0.2.0/24 documentation
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 // multicast and reserved
    );
  }
  const h = hextets(ip);
  if (!h) return true; // not an address we can read: refuse rather than guess
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const zero = (from: number, to: number) => h.slice(from, to).every((x) => x === 0);
  // IPv4 inside IPv6 reaches the IPv4 address: mapped (::ffff:a.b.c.d, which URLs write as
  // ::ffff:7f00:1), compatible (::a.b.c.d), NAT64 (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::).
  if (zero(0, 5) && h[5] === 0xffff) return isPrivateIp(v4(h[6], h[7]));
  if (zero(0, 6)) return true; // ::, ::1 and the deprecated IPv4-compatible range
  if (h[0] === 0x64 && h[1] === 0xff9b && zero(2, 6)) return isPrivateIp(v4(h[6], h[7]));
  if (h[0] === 0x2002) return isPrivateIp(v4(h[1], h[2]));
  return (
    (h[0] & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (h[0] & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (h[0] & 0xffc0) === 0xfec0 || // site-local fec0::/10 (deprecated)
    (h[0] & 0xff00) === 0xff00 || // multicast
    (h[0] === 0x2001 && h[1] === 0x0db8) // documentation
  );
}

/** The eight 16-bit groups of an IPv6 address (with "::" and a trailing dotted quad expanded), or null. */
function hextets(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (!net.isIPv4(dotted[2])) return null;
    const [a, b, c, d] = dotted[2].split('.').map(Number);
    s = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const parts = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...tail];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}

const blocked = () => new Error('private or local addresses are not allowed');

const publicOnlyLookup = ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
  dns.lookup(hostname, { all: true, family: options.family }, (error, addresses) => {
    if (error) return callback(error);
    if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) return callback(blocked());
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}) as unknown as net.LookupFunction;

export interface PublicPage {
  status: number;
  contentType: string;
  body: string;
  url: URL;
}

function getOnce(url: URL, headers: Record<string, string>, signal: AbortSignal, maxBytes: number) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, { headers, signal, lookup: publicOnlyLookup }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return resolve({ status, headers: res.headers, body: '' });
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const done = () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.on('data', (chunk: Buffer) => {
        if (size >= maxBytes) return;
        chunks.push(chunk.subarray(0, maxBytes - size));
        size += chunk.length;
        // A link can point at a huge file: stop reading once we have enough.
        if (size >= maxBytes) res.destroy();
      });
      res.on('end', done);
      res.on('close', done);
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

export async function fetchPublic(
  start: URL,
  { timeoutMs = 12_000, maxBytes = 2_000_000, headers = {} }: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {},
): Promise<PublicPage> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http(s) links can be opened');
    // The lookup above never runs for IP literals, so check those here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivateIp(host)) throw blocked();
    // A login inside the link would be sent on to whatever the link points at; ports beyond the web's
    // usual ones are how a link reaches a service that isn't a web page.
    if (url.username || url.password) throw new Error('links with a user name or password in them are not opened');
    if (url.port && !['80', '443', '8080', '8443'].includes(url.port)) throw new Error('only the usual web ports are opened');
    const res = await getOnce(url, headers, signal, maxBytes);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    return { status: res.status, contentType: String(res.headers['content-type'] ?? ''), body: res.body, url };
  }
  throw new Error('too many redirects');
}
