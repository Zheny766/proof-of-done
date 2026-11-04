// What must never leave the server or reach a page as code: the two secret links, and text anyone
// typed rendered as HTML.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.POD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-leaks-'));
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const { dealRecord } = await import('../lib/escrow/record.ts');
const { publicMilestone, viewerMilestone } = await import('../lib/escrow/access.ts');
const { getEscrowDashboardData } = await import('../lib/escrow/analytics.ts');

const root = path.join(import.meta.dirname, '..');
const sources = (dir: string): string[] =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(path.join(dir, e.name)) : /\.(ts|tsx|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []));

test('no page puts typed text into the page as HTML', () => {
  // React escapes everything it renders; these are the ways around that.
  const offenders = [...sources('app'), ...sources('lib'), ...sources('mcp')].filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write\(/.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('the secret links never appear in what the server hands out', async () => {
  const m = service.createMilestone({ title: '<script>alert(1)</script> Menu', criteria: ['<img src=x onerror=alert(1)> six items'], amount: 50, clientName: 'Maya', clientEmail: 'maya@example.com', freelancerName: 'Diego', freelancerEmail: 'diego@example.com' });
  const { clientKey, freelancerKey } = m.access!;
  const { orderId } = await service.beginFunding(m.id, clientKey);
  await service.confirmFunding(m.id, orderId, clientKey);
  const { reviewId } = await service.submitWork(m.id, { notes: 'Done: https://menu.example/', links: ['https://menu.example/'], files: [] }, freelancerKey);
  await service.runReview(m.id, reviewId);
  const latest = store.getMilestone(m.id)!;
  const outputs = {
    'the deal for its parties': publicMilestone(latest),
    'the deal for anyone else': viewerMilestone(latest),
    'the record for a dispute': dealRecord(latest, 'client', 'https://proof-of-done.example'),
    'the dashboard': getEscrowDashboardData(),
  };
  for (const [what, value] of Object.entries(outputs)) {
    const text = JSON.stringify(value);
    assert.ok(!text.includes(clientKey!) && !text.includes(freelancerKey!), `a key leaked into ${what}`);
  }
  // A wrong key is refused without echoing it back.
  await assert.rejects(service.clientDecision(m.id, 'approve', '', 'guessed-key-123'), (e: Error) => !e.message.includes('guessed-key-123'));
});

test('links that carry a key are never sent on to other sites', () => {
  const config = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8');
  assert.match(config, /Referrer-Policy', value: 'same-origin'/);
});
