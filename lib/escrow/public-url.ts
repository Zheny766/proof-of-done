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
      a >= 224 // multicast and reserved
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
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
