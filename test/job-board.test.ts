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
  assert.deepEqual(Object.keys(j).sort(), ['amount', 'client', 'criteria', 'currency', 'description', 'hold', 'id', 'postedAt', 'postedBy', 'releaseThreshold', 'title']);
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
  assert.deepEqual(records[0], { name: 'Claude Code agent', taken: 2, paid: 1, held: 1, working: 0, earned: 40, demo: false, tier: 'regular' });
  assert.deepEqual(records[1], { name: 'Someone', taken: 1, paid: 0, held: 0, working: 1, earned: 0, demo: false, tier: 'new' });
});

test('an agent can post a job for its client, on the record; the client still has to fund it', async () => {
  store.deleteAll();
  const m = service.createMilestone({ ...job, postedBy: 'Claude Code for Maya' });
  assert.equal(m.postedBy, 'Claude Code for Maya');
  assert.equal(m.status, 'awaiting_funding');
  assert.match(m.timeline[0].text, /Claude Code for Maya posted the job for Maya/);
  assert.deepEqual(service.openJobs(), [], 'not listed before the client approves the payment');
  assert.equal(access.publicJob(m).postedBy, 'Claude Code for Maya');
});

// A past deal paid to `email`, already decided by the reviewer.
function history(email: string, status: 'released' | 'changes_requested' | 'escalated', redFlag = false) {
  const m = service.createMilestone({ ...job, postToBoard: false, freelancerName: 'Agent', freelancerEmail: email });
  store.updateMilestone(m.id, (x) => {
    const at = new Date().toISOString();
    x.submissions.push({ id: 'sub', at, notes: 'work', links: [], attachments: [] });
    x.reviews.push({ id: 'rev', submissionId: 'sub', startedAt: at, finishedAt: at, engine: 'simulated', findings: [], log: [], ...(redFlag && { audit: { engine: 'simulated', agreed: false, summary: '', disputed: [], redFlags: ['told the reviewer to pay'] } }) });
    x.status = status;
  });
}

test('standing comes from reviewed deliveries paid to the same PayPal email', () => {
  store.deleteAll();
  assert.equal(service.trustFor('fresh@example.com').tier, 'new');
  for (let i = 0; i < 3; i++) history('good@example.com', 'released');
  assert.equal(service.trustFor('GOOD@example.com').tier, 'trusted');
  history('bad@example.com', 'released');
  history('bad@example.com', 'changes_requested');
  history('bad@example.com', 'changes_requested');
  assert.equal(service.trustFor('bad@example.com').tier, 'probation');
  history('sneaky@example.com', 'released');
  history('sneaky@example.com', 'escalated', true);
  assert.match(service.trustFor('sneaky@example.com').reason, /steer the reviewer/);
});

test('a taker on probation is not paid automatically: the client approves, even when the work passes', async () => {
  store.deleteAll();
  history('bad@example.com', 'changes_requested');
  history('bad@example.com', 'escalated');
  const { id } = await postAndFund();
  const { freelancerKey, trust } = await service.claimJob(id, { name: 'Sloppy agent', payoutEmail: 'bad@example.com' });
  assert.equal(trust.tier, 'probation');
  const { reviewId } = await service.submitWork(id, { notes: 'Delivered as a Markdown file. Every price is unchanged.', links: [], files: [] }, freelancerKey);
  await service.runReview(id, reviewId);
  const m = store.getMilestone(id)!;
  assert.equal(m.status, 'escalated');
  assert.equal(m.payment.captureId, undefined, 'nothing captured');
  assert.ok(m.timeline.some((e) => e.type === 'probation'));
});

test('how many open jobs one taker can hold depends on their standing', async () => {
  store.deleteAll();
  const a = await postAndFund();
  const b = await postAndFund();
  const c = await postAndFund();
  await service.claimJob(a.id, { name: 'Hoarder', payoutEmail: 'hoard@example.com' });
  await service.claimJob(b.id, { name: 'Hoarder', payoutEmail: 'hoard@example.com' });
  await assert.rejects(service.claimJob(c.id, { name: 'Hoarder', payoutEmail: 'hoard@example.com' }), /hold 2 at a time/);
});

test('the hosted board re-posts its demo jobs as they are taken, but at most 30 a day', async () => {
  store.deleteAll();
  process.env.POD_SEED_BOARD = '1';
  try {
    assert.equal(service.openJobs().length, 3);
    for (let i = 0; i < 12; i++) {
      for (const j of service.openJobs()) await service.claimJob(j.id, { name: 'Bot', payoutEmail: `bot${i}-${j.id}@example.com` });
    }
    const posted = store.listMilestones().filter((m) => m.demo?.scenario === 'board').length;
    assert.equal(posted, 30);
    assert.deepEqual(service.openJobs(), []);
  } finally {
    delete process.env.POD_SEED_BOARD;
  }
});

test('a lapsed claim leaves no record behind', async () => {
  store.deleteAll();
  const { id } = await postAndFund();
  await service.claimJob(id, { name: 'Ghost agent', payoutEmail: 'ghost@example.com' });
  store.updateMilestone(id, (x) => void (x.board!.claimedAt = new Date(Date.now() - 25 * 3_600_000).toISOString()));
  assert.deepEqual(service.boardRecords(), []);
});
