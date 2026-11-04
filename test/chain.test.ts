// The deal's timeline as a hash chain: every step sealed when saved, any later change visible, the
// fingerprint sent to PayPal in the capture note, and the downloaded record checkable offline.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Milestone } from '../lib/escrow/types.ts';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-chain-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const chain = await import('../lib/escrow/chain.ts');
const access = await import('../lib/escrow/access.ts');
const { dealRecord } = await import('../lib/escrow/record.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

async function paid() {
  const m = service.createMilestone({ title: 'Menu for a cafe', criteria: ['A one-page PDF menu'], amount: 100, clientName: 'Maya', clientEmail: 'maya@example.com', freelancerName: 'Diego', freelancerEmail: 'diego@example.com' });
  const { clientKey } = m.access!;
  const { orderId } = await service.beginFunding(m.id, clientKey);
  await service.confirmFunding(m.id, orderId, clientKey);
  await service.clientDecision(m.id, 'approve', '', clientKey);
  return store.getMilestone(m.id)!;
}

test('every step is sealed to the one before it, and the deal page reports the chain intact', async () => {
  const m = await paid();
  assert.ok(m.timeline.every((e) => /^[0-9a-f]{64}$/.test(e.hash ?? '')));
  assert.equal(m.timeline[0].hash, chain.linkHash(m.id, m.timeline[0]));
  assert.equal(m.timeline[1].hash, chain.linkHash(m.timeline[0].hash!, m.timeline[1]));
  const seal = access.publicMilestone(m).seal!;
  assert.deepEqual([seal.intact, seal.events, seal.head], [true, m.timeline.length, m.timeline.at(-1)!.hash]);
  assert.equal(access.viewerMilestone(m).seal?.intact, true, 'outsiders see that it checks out, not the hidden texts');
});

test('changing, removing or reordering a past step breaks the chain from that step on', async () => {
  const m = await paid();
  const edited = structuredClone(m);
  edited.timeline[1].text = 'PayPal authorized 1.00 USD';
  assert.deepEqual([chain.checkSeal(edited).intact, chain.checkSeal(edited).brokenAt], [false, 1]);
  const removed = structuredClone(m);
  removed.timeline.splice(1, 1);
  assert.equal(chain.checkSeal(removed).brokenAt, 1);
  const swapped = structuredClone(m);
  [swapped.timeline[1], swapped.timeline[2]] = [swapped.timeline[2], swapped.timeline[1]];
  assert.equal(chain.checkSeal(swapped).intact, false);

  // An edit saved through the store stays visible: sealing never redoes a step that has a hash.
  store.updateMilestone(m.id, (x) => void (x.timeline[1].text = 'PayPal authorized 1.00 USD'));
  assert.equal(access.publicMilestone(store.getMilestone(m.id)!).seal?.intact, false);
});

test('the fingerprint at payment is kept as the one sent to PayPal, and is a link of the chain', async () => {
  const m = await paid();
  const anchor = m.payment.anchoredRecord!;
  const captured = m.timeline.findIndex((e) => e.type === 'captured');
  const at = m.timeline.findIndex((e) => e.hash === anchor);
  assert.ok(at >= 0 && at < captured, 'a step from before the capture');
});

test('a downloaded record checks out offline, and a changed one does not', async () => {
  const m = await paid();
  const file = path.join(dataDir, 'record.json');
  fs.writeFileSync(file, JSON.stringify(dealRecord(m, 'client', 'https://pod.example')));
  const run = () => {
    try {
      return { code: 0, out: execFileSync('node', ['scripts/verify-record.mjs', file], { encoding: 'utf8' }) };
    } catch (e) {
      return { code: (e as { status: number }).status, out: String((e as { stdout: string }).stdout) };
    }
  };
  const good = run();
  assert.equal(good.code, 0);
  assert.match(good.out, new RegExp(`all ${m.timeline.length} steps check out`));
  assert.match(good.out, /PayPal's fingerprint [0-9a-f]{16} is step \d+/);

  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.timeline[2].text += ' (edited)';
  fs.writeFileSync(file, JSON.stringify(record));
  const bad = run();
  assert.equal(bad.code, 1);
  assert.match(bad.out, /step 3 .* does not match its hash/);
});

test('deals saved before the chain existed get sealed when read', () => {
  const old = { id: 'ms_old', timeline: [{ at: '2026-10-01T00:00:00.000Z', actor: 'client', type: 'created', text: 'Old deal' }] } as unknown as Milestone;
  chain.sealTimeline(old);
  assert.equal(chain.checkSeal(old).intact, true);
});
