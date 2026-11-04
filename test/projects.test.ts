// Projects in stages: each stage is its own milestone with its own PayPal authorization, funded when
// it starts, after the one before it is paid. Simulated mode, throwaway data directory.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-projects-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const access = await import('../lib/escrow/access.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const project = {
  title: 'Website for a bakery',
  description: 'Two stages.',
  clientName: 'Maya',
  clientEmail: 'maya@example.com',
  freelancerName: 'Diego',
  freelancerEmail: 'diego@example.com',
  releaseThreshold: 0.7,
  stages: [
    { title: 'Design', amount: 100, criteria: ['A homepage mockup is delivered as a PNG'] },
    { title: 'Build', amount: 300, criteria: ['The page is live at a public URL'] },
    { title: 'Launch', amount: 50, criteria: ['The domain points to the site'] },
  ],
};

async function fund(id: string, key: string) {
  const { orderId } = await service.beginFunding(id, key);
  await service.confirmFunding(id, orderId, key);
}

test('a project is one milestone per stage, sharing the two links, each with its own amount and criteria', () => {
  const stages = service.createProject(project);
  assert.equal(stages.length, 3);
  const [a, b, c] = stages;
  assert.deepEqual([a.amount, b.amount, c.amount], ['100.00', '300.00', '50.00']);
  assert.equal(b.title, 'Website for a bakery: Build');
  // No plan given: a stage is planned at 7 days.
  assert.deepEqual(b.project, { id: a.project!.id, title: 'Website for a bakery', stage: 2, stageIds: stages.map((m) => m.id), days: 7 });
  assert.equal(access.roleFor(c, a.access!.clientKey), 'client');
  assert.equal(access.roleFor(c, a.access!.freelancerKey), 'freelancer');
  assert.deepEqual(service.projectStages(b)!.map((x) => [x.stage, x.title, x.status]), [[1, 'Design', 'awaiting_funding'], [2, 'Build', 'awaiting_funding'], [3, 'Launch', 'awaiting_funding']]);
});

test('the timeline gets each stage\'s plan and what happened when', async () => {
  store.deleteAll();
  const [a, b] = service.createProject({ ...project, stages: project.stages.map((st, i) => ({ ...st, days: [3, 10, 2][i] })) });
  const { clientKey } = a.access!;
  await fund(a.id, clientKey);
  await service.clientDecision(a.id, 'approve', '', clientKey);
  const [s1, s2, s3] = service.projectStages(store.getMilestone(b.id)!)!;
  assert.deepEqual([s1.days, s2.days, s3.days], [3, 10, 2]);
  assert.ok(s1.fundedAt && s1.paidAt, 'stage 1: held, then paid');
  assert.equal(s1.paid, '100.00');
  assert.equal(s2.fundedAt, undefined);
  assert.equal(s2.paidAt, undefined);
});

test('a stage is funded only after the one before it is paid', async () => {
  store.deleteAll();
  const [a, b] = service.createProject(project);
  const { clientKey, freelancerKey } = a.access!;
  await assert.rejects(service.beginFunding(b.id, clientKey), /Stage 1 isn't paid yet/);
  await fund(a.id, clientKey);
  const { reviewId } = await service.submitWork(a.id, { notes: 'Homepage mockup attached (mockup.png).', links: [], files: [{ name: 'mockup.png', type: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]) }] }, freelancerKey);
  await service.runReview(a.id, reviewId);
  assert.equal(store.getMilestone(a.id)!.status, 'released');
  await fund(b.id, clientKey);
  assert.equal(store.getMilestone(b.id)!.status, 'funded');
});

test('a cancelled stage lets the next one start; projects stay off the open board', async () => {
  store.deleteAll();
  const [a, b] = service.createProject(project);
  await service.clientDecision(a.id, 'cancel', '', a.access!.clientKey);
  await fund(b.id, a.access!.clientKey);
  assert.equal(store.getMilestone(b.id)!.status, 'funded');
  assert.throws(() => service.createProject({ ...project, freelancerName: undefined, freelancerEmail: undefined }), /needs the freelancer/);
  assert.throws(() => service.createProject({ ...project, stages: project.stages.slice(0, 1) }));
});

test('a long project title and stage name still fit a deal title', () => {
  const stages = service.createProject({ ...project, title: 'P'.repeat(110), stages: project.stages.slice(0, 2).map((st) => ({ ...st, title: 'Stage name that is long' })) });
  assert.ok(stages.every((m) => m.title.length <= 120));
});

test('the project demo opens part-way through: stage 1 paid, stage 2 held, stage 3 waiting', () => {
  store.deleteAll();
  const m = service.startDemo('project');
  const stages = service.projectStages(m)!;
  assert.deepEqual(stages.map((s) => s.status), ['released', 'funded', 'awaiting_funding']);
  assert.equal(m.project?.stage, 2, 'the visitor lands on the stage in work');
  assert.ok(Date.parse(stages[0].paidAt!) < Date.parse(stages[1].fundedAt!), 'stage 2 was funded after stage 1 was paid');
  for (const s of stages) assert.equal(access.roleFor(store.getMilestone(s.id)!, m.access!.freelancerKey), 'freelancer');
  // Dated in the past, but opened now: it isn't swept away as an old demo by the next one.
  service.startDemo('honest');
  assert.ok(store.getMilestone(m.id));
});
