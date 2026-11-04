// The stress list from the review of the code: timers against objections, a payment made twice through
// two paths, two agents taking one job, payouts to the client's own address, deals that can't run on a
// simulated or replayed review with real money, and a data folder two servers try to share.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-stress-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const policy = await import('../lib/escrow/policy.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const good = 'The page is live at a public URL: https://bakery.example. The menu lists croissant, baguette, sourdough, brioche, eclair and tart, with prices from $2 to $6.';
async function verified() {
  const m = service.createMilestone({
    title: 'Landing page for a bakery',
    criteria: ['The page is live at a public URL', 'A menu lists at least 6 items with prices'],
    amount: 120,
    clientName: 'Maya',
    clientEmail: 'maya@example.com',
    freelancerName: 'Diego',
    freelancerEmail: 'diego@example.com',
    releaseThreshold: 0.7,
    objectionHours: 1,
  });
  const { clientKey, freelancerKey } = m.access!;
  const { orderId } = await service.beginFunding(m.id, clientKey);
  await service.confirmFunding(m.id, orderId, clientKey);
  const { reviewId } = await service.submitWork(m.id, { notes: good, links: ['https://bakery.example/'], files: [] }, freelancerKey);
  await service.runReview(m.id, reviewId);
  assert.equal(store.getMilestone(m.id)!.status, 'verified');
  return { id: m.id, clientKey: clientKey!, freelancerKey: freelancerKey! };
}
const captures = (id: string) => store.getMilestone(id)!.timeline.filter((e) => e.type === 'captured').length;
const windowClosed = (id: string) => store.updateMilestone(id, (x) => void (x.releaseAt = new Date(Date.now() - 1).toISOString()));

test('an objection a moment before the window closes stops the payment; the late timer finds nothing to pay', async () => {
  const { id, clientKey } = await verified();
  await service.clientDecision(id, 'request_changes', 'The menu is missing the tart prices', clientKey);
  windowClosed(id);
  await service.readMilestone(id);
  assert.equal(store.getMilestone(id)!.status, 'changes_requested');
  assert.equal(captures(id), 0);
});

test('the window closing, a reader and "Pay now" all at once: one capture', async () => {
  const { id, clientKey } = await verified();
  windowClosed(id);
  await Promise.allSettled([service.readMilestone(id), service.readMilestone(id), service.clientDecision(id, 'approve', '', clientKey)]);
  assert.equal(store.getMilestone(id)!.status, 'released');
  assert.equal(captures(id), 1);
});

test('real PayPal money is never released on a review that was not live', () => {
  const m = { payment: { mode: 'sandbox' } } as Parameters<typeof policy.liveReviewRequired>[0];
  assert.equal(policy.liveReviewRequired(m, 'simulated'), true);
  assert.equal(policy.liveReviewRequired(m, 'replay'), true);
  assert.equal(policy.liveReviewRequired(m, 'claude'), false);
  assert.equal(policy.liveReviewRequired({ payment: { mode: 'simulated' } } as typeof m, 'simulated'), false, 'simulated holds are the demo');
});

test('a check that could not answer, or that names a problem, never counts as agreeing', () => {
  const ok = { engine: 'claude' as const, agreed: true, summary: 'fine', disputed: [], redFlags: [] };
  assert.equal(service.panelVerdict(ok, { engine: 'gemini', agreed: true, unavailable: true, summary: 'busy', disputed: [], redFlags: [] }).agreed, false);
  assert.equal(service.combineChecks(ok, { ...ok, engine: 'gemini', disputed: [{ criterionId: 'c1', reason: 'missing' }] }).agreed, false);
  assert.equal(service.combineChecks(ok, { ...ok, engine: 'gemini', redFlags: ['steers the reviewer'] }).agreed, false);
  assert.equal(service.combineChecks(ok, { ...ok, engine: 'gemini' }).agreed, true);
});

test('two agents taking the same job at once: one gets it, with one working key', async () => {
  const job = service.createMilestone({ title: 'Spanish menu', criteria: ['Every item is translated'], amount: 40, clientName: 'Ember', clientEmail: 'ember@example.com', postToBoard: true });
  const { orderId } = await service.beginFunding(job.id, job.access!.clientKey);
  await service.confirmFunding(job.id, orderId, job.access!.clientKey);
  const takers = [1, 2].map((n) => service.claimJob(job.id, { name: `Agent ${n}`, payoutEmail: `agent${n}@example.com` }));
  const results = await Promise.allSettled(takers);
  const won = results.filter((r) => r.status === 'fulfilled');
  assert.equal(won.length, 1);
  const key = (won[0] as PromiseFulfilledResult<{ freelancerKey: string }>).value.freelancerKey;
  assert.equal(store.getMilestone(job.id)!.access!.freelancerKey, key);
});

test('the payout can’t be pointed at the client’s own PayPal', async () => {
  const m = service.createMilestone({ title: 'Logo', criteria: ['An SVG logo'], amount: 50, clientName: 'Maya', clientEmail: 'maya@example.com', freelancerName: 'Diego', freelancerEmail: 'diego@example.com' });
  const { orderId } = await service.beginFunding(m.id, m.access!.clientKey);
  await service.confirmFunding(m.id, orderId, m.access!.clientKey);
  await assert.rejects(service.submitWork(m.id, { notes: 'logo', links: [], files: [], payoutEmail: 'Maya@Example.com' }, m.access!.freelancerKey), /client’s own PayPal/);
});

test('a second server on the same data folder refuses to write', () => {
  store.updateMilestone(store.listMilestones()[0].id, () => {});
  const other = spawnSync(process.execPath, ['--conditions=react-server', '--input-type=module', '-e', `const s = await import(${JSON.stringify(path.resolve('lib/escrow/store.ts'))}); s.deleteAll();`], {
    env: { ...process.env, POD_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  assert.notEqual(other.status, 0);
  assert.match(other.stderr, /Another process .* is writing/);
  assert.ok(store.listMilestones().length > 0, 'the data is untouched');
});
