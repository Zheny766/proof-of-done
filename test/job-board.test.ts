// The open job board: a funded job anyone (or any agent) can take, in simulated mode against a
// throwaway data directory. Run with --conditions=react-server so `server-only` resolves.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-board-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'POD_SEED_BOARD']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const access = await import('../lib/escrow/access.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const job = {
  title: 'Spanish menu for a cafe',
  criteria: ['Delivered as a Markdown file', 'Every price is unchanged'],
  amount: 40,
  clientName: 'Maya',
  clientEmail: 'maya@example.com',
  postToBoard: true,
};

async function postAndFund() {
  const m = service.createMilestone(job);
  const { clientKey } = m.access!;
  const { orderId } = await service.beginFunding(m.id, clientKey);
  await service.confirmFunding(m.id, orderId, clientKey);
  return { id: m.id, clientKey, firstKey: m.access!.freelancerKey };
}

test('a job needs a freelancer unless it goes on the board', () => {
  assert.throws(() => service.createMilestone({ ...job, postToBoard: false }), /freelancer/);
  const m = service.createMilestone(job);
  assert.ok(m.board?.postedAt);
  assert.equal(m.freelancer.email, '');
});

test('only funded jobs are listed: agents see work that is already paid for', async () => {
  store.deleteAll();
  const unfunded = service.createMilestone(job);
  const { id } = await postAndFund();
  const open = service.openJobs().map((m) => m.id);
  assert.deepEqual(open, [id]);
  assert.ok(!open.includes(unfunded.id));
});

test('taking a job hands out a fresh freelancer key and takes it off the board', async () => {
  store.deleteAll();
  const { id, firstKey } = await postAndFund();
  const { milestone, freelancerKey } = await service.claimJob(id, { name: 'Claude Code agent', payoutEmail: 'agent@example.com' });
  assert.notEqual(freelancerKey, firstKey);
  assert.equal(access.roleFor(store.getMilestone(id)!, freelancerKey), 'freelancer');
  // The key minted at creation (never handed out for a board job) no longer works.
  assert.equal(access.roleFor(store.getMilestone(id)!, firstKey), 'viewer');
  assert.equal(milestone.freelancer.email, 'agent@example.com');
  assert.equal(milestone.board?.claimedBy, 'Claude Code agent');
  assert.deepEqual(service.openJobs(), []);
  await assert.rejects(service.claimJob(id, { name: 'Someone else', payoutEmail: 'x@example.com' }), /already took/);
});

test('the agent that took a job delivers and gets paid through the same checks', async () => {
  store.deleteAll();
  const { id } = await postAndFund();
  const { freelancerKey } = await service.claimJob(id, { name: 'Claude Code agent', payoutEmail: 'agent@example.com' });
  const { reviewId } = await service.submitWork(id, { notes: 'Delivered as a Markdown file. Every price is unchanged.', links: [], files: [] }, freelancerKey);
  await service.runReview(id, reviewId);
  const m = store.getMilestone(id)!;
  assert.equal(m.status, 'released');
  assert.equal(m.payment.payoutStatus, 'SUCCESS');
});

test('a claim with no delivery lapses after a day and the job goes back on the board', async () => {
  store.deleteAll();
  const { id } = await postAndFund();
  const first = await service.claimJob(id, { name: 'Slow agent', payoutEmail: 'slow@example.com' });
  store.updateMilestone(id, (x) => void (x.board!.claimedAt = new Date(Date.now() - 25 * 3_600_000).toISOString()));
  assert.deepEqual(service.openJobs().map((m) => m.id), [id]);
  const second = await service.claimJob(id, { name: 'Fast agent', payoutEmail: 'fast@example.com' });
  assert.equal(access.roleFor(store.getMilestone(id)!, first.freelancerKey), 'viewer');
  assert.equal(access.roleFor(store.getMilestone(id)!, second.freelancerKey), 'freelancer');
});

test('a job that is not on the board cannot be claimed', async () => {
  const m = service.createMilestone({ ...job, postToBoard: false, freelancerName: 'Diego', freelancerEmail: 'diego@example.com' });
  await assert.rejects(service.claimJob(m.id, { name: 'Agent', payoutEmail: 'a@example.com' }), /not on the open board/);
});

test('the public job shows what to do and what it pays, nothing private', async () => {
  store.deleteAll();
  const { id } = await postAndFund();
  const j = access.publicJob(store.getMilestone(id)!);
  assert.deepEqual(Object.keys(j).sort(), ['amount', 'client', 'criteria', 'currency', 'description', 'hold', 'id', 'postedAt', 'releaseThreshold', 'title']);
  assert.ok(!JSON.stringify(j).includes('maya@example.com'));
});

test('track records come from confirmed outcomes: paid after review, held, still working', async () => {
  store.deleteAll();
  const take = async (name: string, email: string) => {
    const { id } = await postAndFund();
    const { freelancerKey } = await service.claimJob(id, { name, payoutEmail: email });
    return { id, freelancerKey };
  };
  const a = await take('Claude Code agent', 'agent@example.com');
  const { reviewId } = await service.submitWork(a.id, { notes: 'Delivered as a Markdown file. Every price is unchanged.', links: [], files: [] }, a.freelancerKey);
  await service.runReview(a.id, reviewId);
  const b = await take('Claude Code agent', 'agent@example.com');
  const r2 = await service.submitWork(b.id, { notes: 'Done, trust me.', links: [], files: [] }, b.freelancerKey);
  await service.runReview(b.id, r2.reviewId);
  await take('Someone', 'someone@example.com');
  const records = service.boardRecords();
  assert.deepEqual(records[0], { name: 'Claude Code agent', taken: 2, paid: 1, held: 1, working: 0, earned: 40 });
  assert.deepEqual(records[1], { name: 'Someone', taken: 1, paid: 0, held: 0, working: 1, earned: 0 });
});
