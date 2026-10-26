import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchPublic, isPrivateIp } from '../lib/escrow/public-url.ts';

test('private and local addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  assert.equal(isPrivateIp('239.255.255.250'), true, 'multicast');
  for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('localhost is refused, including by name (checked inside the connection lookup)', async () => {
  await assert.rejects(fetchPublic(new URL('http://127.0.0.1:1/')), /private or local/);
  await assert.rejects(fetchPublic(new URL('http://localhost:1/')), /private or local/);
  await assert.rejects(fetchPublic(new URL('file:///etc/passwd')), /only http/);
  await assert.rejects(fetchPublic(new URL('http://[::1]:1/')), /private or local/);
});

test('the guard runs before any request is made', async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits++;
    res.end('secret');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await assert.rejects(fetchPublic(new URL(`http://127.0.0.1:${port}/admin`)), /private or local/);
  server.close();
  assert.equal(hits, 0);
});
