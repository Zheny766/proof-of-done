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
  assert.deepEqual(b.project, { id: a.project!.id, title: 'Website for a bakery', stage: 2, stageIds: stages.map((m) => m.id) });
  assert.equal(access.roleFor(c, a.access!.clientKey), 'client');
  assert.equal(access.roleFor(c, a.access!.freelancerKey), 'freelancer');
  assert.deepEqual(service.projectStages(b)!.map((x) => [x.stage, x.title, x.status]), [[1, 'Design', 'awaiting_funding'], [2, 'Build', 'awaiting_funding'], [3, 'Launch', 'awaiting_funding']]);
});

test('a stage is funded only after the one before it is paid', async () => {
  store.deleteAll();
  const [a, b] = service.createProject(project);
  const { clientKey, freelancerKey } = a.access!;
  await assert.rejects(service.beginFunding(b.id, clientKey), /Stage 1 isn't paid yet/);
  await fund(a.id, clientKey);
  const { reviewId } = await service.submitWork(a.id, { notes: 'A homepage mockup is delivered as a PNG.', links: [], files: [] }, freelancerKey);
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
