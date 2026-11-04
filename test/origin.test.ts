// Where the server calls itself: never an address taken from a header a client chose.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { publicOrigin, selfOrigin } from '../lib/origin.ts';

afterEach(() => {
  delete process.env.POD_PUBLIC_URL;
  delete process.env.RENDER_EXTERNAL_URL;
});

test('with a configured public URL, headers change nothing', () => {
  process.env.RENDER_EXTERNAL_URL = 'https://pod.example/';
  const forged = new Request('http://169.254.169.254/api/mcp', { headers: { 'x-forwarded-host': '10.0.0.5' } });
  assert.equal(selfOrigin(forged), 'https://pod.example');
  assert.equal(publicOrigin(forged), 'https://pod.example');
});

test('without one, only this machine is trusted, and not when a proxy header names another host', () => {
  assert.equal(selfOrigin(new Request('http://localhost:3111/api/mcp')), 'http://localhost:3111');
  assert.equal(selfOrigin(new Request('http://127.0.0.1:3000/api/mcp')), 'http://127.0.0.1:3000');
  assert.equal(selfOrigin(new Request('http://169.254.169.254/api/mcp')), null);
  assert.equal(selfOrigin(new Request('http://internal.corp:8080/api/mcp')), null);
  assert.equal(selfOrigin(new Request('http://localhost:3111/api/mcp', { headers: { 'x-forwarded-host': '10.0.0.5' } })), null);
  assert.equal(selfOrigin(new Request('http://localhost:3111/api/mcp', { headers: { 'x-forwarded-host': 'localhost:3111' } })), 'http://localhost:3111', 'as Next fills it in');
});
