// The OpenAPI document matches the server: every path it lists is a route with that method, every
// public route is in it, and request bodies come from the schemas the routes validate with.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.POD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-openapi-'));
const { openApiDocument } = await import('../lib/openapi.ts');
const doc = openApiDocument('https://pod.example');

// Routes on disk, as OpenAPI paths: app/api/escrow/milestones/[id]/terms/route.ts -> /api/escrow/milestones/{id}/terms
function routes(dir = 'app/api', prefix = '/api'): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const seg = entry.name.startsWith('[...') ? null : entry.name.replace(/^\[(\w+)\]$/, '{$1}');
      if (seg) for (const [k, v] of routes(full, `${prefix}/${seg}`)) out.set(k, v);
    } else if (entry.name === 'route.ts') {
      const src = fs.readFileSync(full, 'utf8');
      out.set(prefix, [...src.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1].toLowerCase()));
    }
  }
  return out;
}
// Used by the site's own pages, not an API to build on.
const INTERNAL = ['/api/ai/claude', '/api/demo/deliver', '/api/demo/arena', '/api/escrow/demo'];

test('every path and method in the document is a real route', () => {
  const real = routes();
  for (const [p, ops] of Object.entries(doc.paths)) {
    assert.ok(real.has(p), `${p} has no route file`);
    for (const method of Object.keys(ops)) assert.ok(real.get(p)!.includes(method), `${method.toUpperCase()} ${p} is not exported`);
  }
});

test('every public route is documented', () => {
  for (const p of routes().keys()) if (!INTERNAL.includes(p)) assert.ok(p in doc.paths, `${p} is missing from openapi.json`);
});

test('request bodies are the routes’ own validation rules', () => {
  const create = doc.paths['/api/escrow/milestones'].post.requestBody.content['application/json'].schema as { properties: Record<string, { maxItems?: number }>; required: string[] };
  assert.equal(create.properties.criteria.maxItems, 12);
  assert.ok(create.required.includes('title'));
  const terms = doc.paths['/api/escrow/milestones/{id}/terms'].post.requestBody.content['application/json'].schema as { oneOf: { properties: { action: { const: string } } }[] };
  assert.deepEqual(terms.oneOf.map((o) => o.properties.action.const), ['propose', 'accept', 'decline']);
  assert.equal(doc.openapi, '3.1.0');
  assert.equal(doc.servers[0].url, 'https://pod.example');
});

test('every $ref points at a schema the document defines', () => {
  const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 10);
  for (const r of refs) assert.ok(r in doc.components.schemas, `#/components/schemas/${r} is not defined`);
  for (const [p, ops] of Object.entries(doc.paths)) for (const op of Object.values(ops)) assert.ok((op as { responses?: object }).responses, `${p} has no responses`);
});
