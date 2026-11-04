// Facts are the AI's, taste is the client's: a criterion marked for the client ("the logo feels warm")
// is left out of the release rule and the second opinions, and a deal that has one always goes through
// the client's objection window before PayPal captures.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Criterion } from '../lib/escrow/types.ts';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-taste-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const { checkReleasePolicy } = await import('../lib/escrow/policy.ts');
const { sealedTerms, termsDigest } = await import('../lib/escrow/chain.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const logo = (over: Record<string, unknown> = {}) => ({
  title: 'Logo for a flower shop',
  criteria: ['Delivered as an SVG file', 'Uses only the shop colours green and cream', { text: 'The logo feels warm and friendly', judge: 'client' }],
  amount: 200,
  clientName: 'Petal & Stem',
  clientEmail: 'owner@petal.example',
  freelancerName: 'Ana',
  freelancerEmail: 'ana@studio.example',
  releaseThreshold: 0.7,
  ...over,
});

// A delivery that describes the work (notes that only repeat the criteria are a red flag of their own).
const NOTES = 'Delivered the logo as an SVG file at the link below: a single stem with two petals drawn in flat shapes. It uses only the shop colours, green and cream, nothing else, and stays crisp at any size.';

async function funded(over: Record<string, unknown> = {}) {
  const m = service.createMilestone(logo(over));
  const { clientKey, freelancerKey } = m.access!;
  const { orderId } = await service.beginFunding(m.id, clientKey);
  await service.confirmFunding(m.id, orderId, clientKey);
  return { id: m.id, clientKey, freelancerKey };
}

test('a criterion can be marked for the client; plain strings are for the AI', () => {
  const m = service.createMilestone(logo());
  assert.deepEqual(
    m.criteria.map((c) => [c.text, c.judge ?? 'ai']),
    [
      ['Delivered as an SVG file', 'ai'],
      ['Uses only the shop colours green and cream', 'ai'],
      ['The logo feels warm and friendly', 'client'],
    ],
  );
});

test('the release rule leaves the client’s criteria out, and never pays when every criterion is theirs', () => {
  const criteria: Criterion[] = [
    { id: 'c1', text: 'Delivered as an SVG file' },
    { id: 'c2', text: 'Feels warm', judge: 'client' },
  ];
  const met = { criterionId: 'c1', status: 'met' as const, confidence: 0.95, evidence: 'svg' };
  const taste = { criterionId: 'c2', status: 'unclear' as const, confidence: 0.5, evidence: 'Left to the client' };
  assert.equal(checkReleasePolicy(criteria, [met, taste], 0.8).ok, true);
  assert.equal(checkReleasePolicy(criteria, [{ ...met, status: 'not_met' }, taste], 0.8).ok, false);
  const allTaste = checkReleasePolicy([{ id: 'c1', text: 'Feels warm', judge: 'client' }], [taste], 0.8);
  assert.equal(allTaste.ok, false);
  assert.match(allTaste.reasons[0], /client’s call/);
});

test('with a criterion for the client, the AI’s check opens a 24 h objection window instead of paying', async () => {
  const { id, freelancerKey } = await funded();
  const { reviewId } = await service.submitWork(
    id,
    { notes: NOTES, links: ['https://petal.example/logo.svg'], files: [] },
    freelancerKey,
  );
  await service.runReview(id, reviewId);
  const m = store.getMilestone(id)!;
  assert.equal(m.status, 'verified');
  assert.equal(m.payment.captureId, undefined, 'nothing captured before the client has had their say');
  const hours = (Date.parse(m.releaseAt!) - Date.now()) / 3_600_000;
  assert.ok(hours > 23.9 && hours <= 24, `window of ${hours} h`);
  assert.match(m.timeline.find((e) => e.type === 'release_scheduled')!.text, /judges the rest/);
  const taste = m.reviews.at(-1)!.findings.find((f) => f.criterionId === 'c3')!;
  assert.equal(taste.status, 'unclear');
});

test('a window the client chose is kept', async () => {
  const { id, freelancerKey } = await funded({ objectionHours: 48 });
  const { reviewId } = await service.submitWork(
    id,
    { notes: NOTES, links: ['https://petal.example/logo.svg'], files: [] },
    freelancerKey,
  );
  await service.runReview(id, reviewId);
  const hours = (Date.parse(store.getMilestone(id)!.releaseAt!) - Date.now()) / 3_600_000;
  assert.ok(hours > 47.9 && hours <= 48);
});

test('who judges a criterion is sealed; deals without any keep the digest they always had', () => {
  const plain = { criteria: [{ id: 'c1', text: 'An SVG file' }], amount: '10.00', currency: 'USD', submissions: [], freelancer: { name: 'A', email: 'a@x.example' } };
  assert.deepEqual(sealedTerms(plain).criteria, ['An SVG file']);
  const taste = { ...plain, criteria: [{ id: 'c1', text: 'An SVG file', judge: 'client' as const }] };
  assert.notEqual(termsDigest(sealedTerms(taste)), termsDigest(sealedTerms(plain)));
});

test('new terms keep who judges a criterion that stays', async () => {
  const { id, clientKey, freelancerKey } = await funded();
  await service.changeTerms(id, { action: 'propose', criteria: ['Delivered as an SVG file', 'The logo feels warm and friendly'], amount: 150 }, clientKey);
  const m = await service.changeTerms(id, { action: 'accept' }, freelancerKey);
  assert.deepEqual(
    m.criteria.map((c) => c.judge ?? 'ai'),
    ['ai', 'client'],
  );
});
