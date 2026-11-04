// Every route refuses a body it would have to buffer blindly: no stated size, or too large.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.POD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-http-'));
const { handle } = await import('../lib/escrow/http.ts');

const route = handle(async (request: Request) => Response.json(await request.json()));
const upload = handle(async (request: Request) => Response.json({ method: request.method }), { maxBytes: 5_000_000 });

test('a body without a Content-Length is refused before it is read', async () => {
  const stream = new ReadableStream({ start: (c) => (c.enqueue(new TextEncoder().encode('{"a":1}')), c.close()) });
  const res = await route(new Request('http://x/api', { method: 'POST', body: stream, duplex: 'half', headers: { 'transfer-encoding': 'chunked' } } as RequestInit));
  assert.equal(res.status, 411);
  // A bare POST (no body, no length) is not refused for its size.
  const bare = handle(async (request: Request) => Response.json({ method: request.method }));
  assert.equal((await bare(new Request('http://x/api', { method: 'POST' }))).status, 200);
});

test('a body over the limit is refused; a route can allow more', async () => {
  const big = (n: number) => new Request('http://x/api', { method: 'POST', body: 'x', headers: { 'content-length': String(n) } });
  assert.equal((await route(big(2_000_000))).status, 413);
  assert.equal((await upload(big(2_000_000))).status, 200);
  assert.equal((await upload(big(6_000_000))).status, 413);
  const ok = await route(new Request('http://x/api', { method: 'POST', body: '{"a":1}', headers: { 'content-length': '7' } }));
  assert.deepEqual(await ok.json(), { a: 1 });
});

test('a write another site triggered is refused (CSRF)', async () => {
  const res = await route(new Request('http://x/api', { method: 'POST', body: '{}', headers: { 'content-length': '2', 'sec-fetch-site': 'cross-site' } }));
  assert.equal(res.status, 403);
});
