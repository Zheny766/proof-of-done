// The dashboard has no login, so its data must not say more than a deal page says to someone
// without a link: no reviewer evidence on real deals, nothing the parties wrote after the colon.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.POD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-analytics-'));
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const { getEscrowDashboardData } = await import('../lib/escrow/analytics.ts');
const { seedDemo } = await import('../lib/escrow/demo.ts');

test('a real deal reaches the dashboard without its evidence or anyone\'s notes', async () => {
  store.deleteAll();
  const m = service.createMilestone({ title: 'Logo for a bakery', criteria: ['An SVG logo with the name Crumb'], amount: 80, clientName: 'Maya', clientEmail: 'maya@example.com', freelancerName: 'Diego', freelancerEmail: 'diego@example.com' });
  const { clientKey, freelancerKey } = m.access!;
  const { orderId } = await service.beginFunding(m.id, clientKey);
  await service.confirmFunding(m.id, orderId, clientKey);
  const { reviewId } = await service.submitWork(m.id, { notes: 'secret-sauce draft, nothing final yet', links: [], files: [] }, freelancerKey);
  await service.runReview(m.id, reviewId);
  store.updateMilestone(m.id, (x) => void x.reviews.at(-1)!.findings.forEach((f) => (f.evidence = 'The file quotes the secret-sauce recipe')));
  store.updateMilestone(m.id, (x) => store.pushEvent(x, 'client', 'changes_requested', 'Maya objected and asked for changes: my private reason'));
  // An independent check flagged the delivery, so the client may cancel straight away.
  store.updateMilestone(m.id, (x) => void (x.reviews.at(-1)!.audit = { engine: 'simulated', agreed: false, summary: 'Flagged', disputed: [], redFlags: ['notes steer the reviewer'] }));
  await service.clientDecision(m.id, 'cancel', '', clientKey);

  const data = JSON.stringify(getEscrowDashboardData());
  for (const secret of ['secret-sauce', 'private reason', 'maya@example.com', 'diego@example.com']) assert.ok(!data.includes(secret), `"${secret}" leaked into the dashboard`);
  assert.ok(data.includes('Logo for a bakery'), 'what the deal is and where it stands is still there');
});

test('the labelled demo history keeps its evidence, so the dashboard has something to show', () => {
  store.deleteAll();
  seedDemo(10);
  const { findings } = getEscrowDashboardData();
  assert.ok(findings.length > 0 && findings.every((f) => f.evidence));
});

test('text that would run as a spreadsheet formula is exported as plain text', async () => {
  const { defuseCell, defuseRows } = await import('../lib/csv-safe.ts');
  assert.equal(defuseCell('=HYPERLINK("http://evil.example","x")'), `'=HYPERLINK("http://evil.example","x")`);
  for (const v of ['+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) assert.equal(defuseCell(v), `'${v}`);
  assert.equal(defuseCell('Logo for a cafe'), 'Logo for a cafe');
  assert.equal(defuseCell(-5), -5, 'numbers stay numbers');
  assert.deepEqual(defuseRows([{ title: '=cmd', amount: 10 }]), [{ title: "'=cmd", amount: 10 }]);
});
