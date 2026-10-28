// A buyer's PayPal dispute is answered with the deal's own record: a note and a PDF built from the
// criteria, the delivery, the review and the PayPal ids. Simulated mode for the deal, plus a fake
// PayPal for the evidence call itself.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Milestone } from '../lib/escrow/types.ts';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-disputes-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const disputes = await import('../lib/escrow/disputes.ts');
const payments = await import('../lib/escrow/payments.ts');
const { textPdf } = await import('../lib/escrow/pdf.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const ORIGIN = 'https://pod.example';

async function paid() {
  const m = service.createMilestone({ title: 'Menu for a cafe', criteria: ['A one-page PDF menu', 'At least 10 dishes with prices'], amount: 100, clientName: 'Maya', clientEmail: 'maya@example.com', freelancerName: 'Diego', freelancerEmail: 'diego@example.com' });
  const { clientKey, freelancerKey } = m.access!;
  const { orderId } = await service.beginFunding(m.id, clientKey);
  await service.confirmFunding(m.id, orderId, clientKey);
  const { reviewId } = await service.submitWork(m.id, { notes: 'A one-page PDF menu with 12 dishes and prices.', links: [], files: [{ name: 'menu.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4 menu') }] }, freelancerKey);
  await service.runReview(m.id, reviewId);
  const x = store.getMilestone(m.id)!;
  if (x.status !== 'released') await service.clientDecision(m.id, 'approve', '', clientKey);
  return { id: m.id, clientKey, freelancerKey };
}

const disputeEvent = (m: Milestone, id = 'PP-D-7', type = 'CREATED', status = 'WAITING_FOR_SELLER_RESPONSE') => ({
  id: `WH-${id}-${type}`,
  event_type: `CUSTOMER.DISPUTE.${type}`,
  resource: { dispute_id: id, reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', status, dispute_amount: { value: '100.00', currency_code: 'USD' }, disputed_transactions: [{ seller_transaction_id: m.payment.captureId }] },
});

async function until(check: () => boolean) {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
}

test('the evidence note fits PayPal’s 2000 characters and says what was agreed, delivered, checked and captured', async () => {
  const { id } = await paid();
  const m = store.getMilestone(id)!;
  const note = disputes.evidenceNote(m, ORIGIN);
  assert.ok(note.length <= 2000);
  assert.match(note, /1\. A one-page PDF menu - met \(\d+%\)/);
  assert.match(note, /Delivered .*menu\.pdf sha256 [0-9a-f]{16}/);
  assert.match(note, new RegExp(`PayPal captured 100.00 USD .*capture ${m.payment.captureId}`));
  assert.match(note, new RegExp(`${ORIGIN}/m/${id}/proof`));

  const long = { ...m, criteria: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, text: 'x'.repeat(290) })) };
  assert.equal(disputes.evidenceNote(long, ORIGIN).length, 2000);
});

test('the record PDF is a valid PDF: every object where the cross-reference table says, text PayPal can show', () => {
  const pdf = textPdf([{ text: 'Proof of Done', bold: true, size: 16 }, ...Array.from({ length: 120 }, (_, i) => ({ text: `Line ${i} with “quotes”, a dash – and 漢字 (brackets) \\ backslash` }))]).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
  assert.ok(pdf.slice(xref).startsWith('xref'));
  const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((x) => Number(x[1]));
  offsets.forEach((o, i) => assert.ok(pdf.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  assert.match(pdf, /\/Count [2-9]/, 'long text runs onto more pages');
  assert.match(pdf, /\(Line 0 with "quotes", a dash - and \?\? \\\(brackets\\\) \\\\ backslash\) Tj/);
  const two = textPdf([{ text: 'First line\nSecond line' }]).toString('latin1');
  assert.match(two, /\(First line\) Tj ET\nBT \/F1 10 Tf 50 [\d.]+ Td \(Second line\) Tj/, 'a newline starts a new line, not a question mark');
});

test('a dispute on a paid deal gets the deal’s evidence by itself, once', async () => {
  const { id } = await paid();
  await service.applyWebhook(disputeEvent(store.getMilestone(id)!), ORIGIN);
  await until(() => !!store.getMilestone(id)!.disputes?.[0].evidenceSentAt);
  const m = store.getMilestone(id)!;
  assert.ok(m.disputes?.[0].evidenceSentAt, 'sent');
  assert.match(m.timeline.at(-1)!.text, /The deal's evidence went to PayPal for dispute PP-D-7: proof the service was delivered.*proof-of-done-ms_/);

  await service.applyWebhook(disputeEvent(m, 'PP-D-7', 'UPDATED'), ORIGIN);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(store.getMilestone(id)!.timeline.filter((e) => e.type === 'dispute_evidence').length, 1, 'not sent twice');
});

test('only the freelancer sends it by hand; a refund already made goes along as proof of refund', async () => {
  const { id, clientKey, freelancerKey } = await paid();
  await service.afterPayment(id, { action: 'complain', text: 'Two prices are wrong', amount: 20 }, clientKey);
  await service.afterPayment(id, { action: 'refund' }, freelancerKey);
  store.updateMilestone(id, (x) => void (x.disputes = [{ id: 'PP-D-9', reason: 'other', status: 'OPEN', openedAt: '', updatedAt: '' }]));
  await assert.rejects(service.answerDispute(id, 'PP-D-9', ORIGIN, clientKey), /Only the freelancer/);
  await assert.rejects(service.answerDispute(id, 'PP-D-9', ORIGIN, null), /Only the freelancer/);
  await assert.rejects(service.answerDispute(id, 'PP-D-0', ORIGIN, freelancerKey), /no such PayPal dispute/);

  const { evidences } = disputes.disputeEvidence(store.getMilestone(id)!, ORIGIN);
  assert.deepEqual(evidences.map((e) => e.evidence_type), ['PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED', 'PROOF_OF_REFUND']);
  assert.equal((evidences[1].evidence_info as { refund_ids: string[] }).refund_ids.length, 1);
  const sent = await service.answerDispute(id, 'PP-D-9', ORIGIN, freelancerKey);
  assert.match(sent.timeline.at(-1)!.text, /proof the service was delivered and proof of the refund/);
});

test('on the PayPal sandbox the evidence goes only when the dispute offers it: a JSON part and the PDF', async () => {
  const deal = await paid();
  const calls: { method: string; path: string; type: string; body: string; key?: string }[] = [];
  let links: { rel: string; href: string }[] = [];
  const real = globalThis.fetch;
  process.env.PAYPAL_CLIENT_ID = 'test-id';
  process.env.PAYPAL_SECRET = 'test-secret';
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const { pathname } = new URL(url);
    if (pathname === '/v1/oauth2/token') return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    const headers = init.headers as Record<string, string>;
    calls.push({ method: init.method ?? 'GET', path: pathname, type: headers['Content-Type'] ?? '', body: init.body ? Buffer.from(init.body as Uint8Array).toString('latin1') : '', key: headers['PayPal-Request-Id'] });
    if (init.method === 'GET') return new Response(JSON.stringify({ dispute_id: 'PP-D-5', status: 'WAITING_FOR_SELLER_RESPONSE', dispute_life_cycle_stage: 'INQUIRY', links }));
    return new Response(JSON.stringify({ links: [] }));
  }) as typeof fetch;
  try {
    const m = { ...store.getMilestone(deal.id)!, payment: { mode: 'sandbox', captureId: 'CAP5' } } as Milestone;
    const { evidences, files } = disputes.disputeEvidence(m, ORIGIN);
    const waiting = await payments.answerDisputeOnPayPal(m, 'PP-D-5', evidences, files);
    assert.equal(waiting.sent, false);
    assert.match(waiting.note!, /isn't taking evidence on this dispute yet \(waiting for seller response, inquiry stage\)/);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);

    links = [{ rel: 'provide_evidence', href: 'https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-5/provide-evidence' }];
    assert.equal((await payments.answerDisputeOnPayPal(m, 'PP-D-5', evidences, files)).sent, true);
    const post = calls.find((c) => c.method === 'POST')!;
    assert.equal(post.path, '/v1/customer/disputes/PP-D-5/provide-evidence');
    const boundary = post.type.match(/^multipart\/form-data; boundary=(.+)$/)![1];
    const parts = post.body.split(`--${boundary}`);
    assert.match(parts[1], /name="input"\r\nContent-Type: application\/json\r\n\r\n\{"evidences":\[\{"evidence_type":"PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED","notes":"Service delivered/);
    assert.match(parts[2], /name="file1"; filename="proof-of-done-ms_\w+\.pdf"\r\nContent-Type: application\/pdf\r\n\r\n%PDF-1\.4/);
    assert.match(post.key ?? '', /^evidence-PP-D-5-\d+$/);
  } finally {
    globalThis.fetch = real;
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_SECRET;
  }
});
