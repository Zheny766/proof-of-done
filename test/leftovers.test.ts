// The last of the stress list: names in any script on a dispute PDF, criteria that contradict each
// other, a review that failed on our side, a fix window that would outlast PayPal's hold, and a stored
// file changed after delivery.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-leftovers-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const policy = await import('../lib/escrow/policy.ts');
const { textPdf } = await import('../lib/escrow/pdf.ts');
const { criteriaConflict } = await import('../lib/escrow/criteria-lint.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const deal = (over: Record<string, unknown> = {}) => ({ title: 'Menu translation', criteria: ['Every item is translated'], amount: 40, clientName: 'Maya', clientEmail: 'maya@example.com', freelancerName: 'Diego', freelancerEmail: 'diego@example.com', ...over });
async function funded(over: Record<string, unknown> = {}) {
  const m = service.createMilestone(deal(over));
  const { orderId } = await service.beginFunding(m.id, m.access!.clientKey);
  await service.confirmFunding(m.id, orderId, m.access!.clientKey);
  return m;
}

test('a dispute PDF keeps Russian and Vietnamese names readable, and stays a valid PDF for any script', () => {
  const pdf = textPdf([{ text: 'Никита Соколов paid Phở Hà Nội; 北京 مرحبا Đức' }]).toString('latin1');
  assert.match(pdf, /Nikita Sokolov/);
  assert.match(pdf, /Pho Hà Noi/, 'à is drawn as is; ở and ộ lose only their extra marks');
  assert.match(pdf, /\?\? \?{5} Duc/, 'what no Latin letter can stand for becomes ?');
  const xref = Number(pdf.match(/startxref\s+(\d+)/)![1]);
  assert.equal(pdf.slice(xref, xref + 4), 'xref', 'the cross-reference table is where the trailer says');
});

test('criteria that contradict each other are refused while the deal is written', () => {
  assert.match(criteriaConflict(['The menu has exactly 12 lines', 'It has at least 15 lines']) ?? '', /exactly 12 lines.*at least 15 lines/);
  assert.match(criteriaConflict(['Each description is 40 to 80 words', 'Each description is at most 30 words']) ?? '', /can't both be true/);
  assert.equal(criteriaConflict(['Each description is 40 to 80 words', 'No description is more than 90 words']), null, 'a negation it can’t read is left alone');
  assert.equal(criteriaConflict(['At least 6 items with prices', 'Exactly 12 items in total']), null);
  assert.equal(criteriaConflict(['All five candles have a description', 'Each description is 40 to 80 words', 'No exclamation marks anywhere']), null);
  assert.throws(() => service.createMilestone(deal({ criteria: ['Exactly 10 slides', 'At most 8 slides'] })), /contradict each other/);
});

test('a review that failed on our side does not use up one of the 12 deliveries', async () => {
  const m = await funded();
  store.updateMilestone(m.id, (x) => {
    for (let i = 0; i < 12; i++) {
      x.submissions.push({ id: `sub_f${i}`, at: new Date().toISOString(), notes: `try ${i}`, links: [], attachments: [] });
      x.reviews.push({ id: `rev_f${i}`, submissionId: `sub_f${i}`, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), engine: 'claude', findings: [], decision: 'escalate', log: [{ at: new Date().toISOString(), kind: 'error', text: 'Claude API error: overloaded' }] });
    }
    x.status = 'changes_requested';
  });
  await service.submitWork(m.id, { notes: 'The real delivery', links: [], files: [] }, m.access!.freelancerKey);
  assert.equal(store.getMilestone(m.id)!.status, 'reviewing');
});

test('the time to fix never runs past the end of PayPal’s hold', async () => {
  const m = await funded();
  store.updateMilestone(m.id, (x) => {
    x.submissions.push({ id: 'sub_1', at: new Date().toISOString(), notes: 'draft', links: [], attachments: [] });
    x.status = 'changes_requested';
    store.pushEvent(x, 'agent', 'changes_requested', 'AI reviewer asked for changes: two items missing');
    x.payment.expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  });
  const block = policy.cancelBlock(store.getMilestone(m.id)!);
  assert.match(block ?? '', /when PayPal's hold ends/);
  assert.ok(!policy.cancelBlock(store.getMilestone(m.id)!, Date.now() + 2 * 86_400_000), 'after the hold ends the client is not held back');
});

test('a stored file changed after delivery no longer matches its fingerprint', async () => {
  const m = await funded();
  await service.submitWork(m.id, { notes: 'Menu attached', links: [], files: [{ name: 'menu-es.md', type: 'text/markdown', bytes: Buffer.from('# Menú\n- Café $3') }] }, m.access!.freelancerKey);
  const a = store.getMilestone(m.id)!.submissions[0].attachments[0];
  assert.equal(store.storedFileIntact(a), true);
  fs.writeFileSync(path.join(store.UPLOAD_DIR, a.file), '# Menú\n- Café $30');
  assert.equal(store.storedFileIntact(a), false);
  assert.equal(store.storedFileIntact({ file: a.file }), null, 'no fingerprint, nothing to compare');
});
