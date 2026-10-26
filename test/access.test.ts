import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAccess, publicMilestone, roleFor, viewerMilestone } from '../lib/escrow/access.ts';
import type { Milestone } from '../lib/escrow/types.ts';

const milestone = { id: 'ms_1', title: 'Logo', access: newAccess() } as Milestone;

test('each key maps to its role, anything else is a viewer', () => {
  assert.equal(roleFor(milestone, milestone.access!.clientKey), 'client');
  assert.equal(roleFor(milestone, milestone.access!.freelancerKey), 'freelancer');
  assert.equal(roleFor(milestone, 'nope'), 'viewer');
  assert.equal(roleFor(milestone, ''), 'viewer');
  assert.equal(roleFor(milestone, null), 'viewer');
  assert.equal(roleFor(milestone, 'é'.repeat(24)), 'viewer');
});

test('milestones without keys (older data) only have viewers', () => {
  assert.equal(roleFor({ id: 'old' } as Milestone, 'anything'), 'viewer');
});

test('public data never contains the keys', () => {
  const pub = publicMilestone(milestone);
  assert.equal('access' in pub, false);
  assert.ok(!JSON.stringify(pub).includes(milestone.access!.clientKey));
  assert.ok(milestone.access, 'the original is left untouched');
});

test('a viewer sees progress, not the work or contact details', () => {
  const full = {
    id: 'ms_2',
    title: 'Logo',
    description: 'Secret brief',
    client: { name: 'Maya', email: 'maya@example.com' },
    freelancer: { name: 'Diego', email: 'diego@example.com' },
    payment: { mode: 'sandbox', payerEmail: 'buyer@example.com', captureId: 'CAP1' },
    submissions: [{ id: 's', at: '', notes: 'my work', links: ['https://x.example'], attachments: [{ id: 'a', name: 'a.png', mime: 'image/png', size: 1, file: 'ms_2/s/0_a.png' }] }],
    reviews: [{ id: 'r', submissionId: 's', startedAt: '', engine: 'claude', findings: [{ criterionId: 'c1', status: 'met', confidence: 0.9, evidence: 'saw it' }], log: [{ at: '', kind: 'tool', text: 'x' }], summary: 'ok', feedback: 'fix' }],
    timeline: [
      { at: '', actor: 'paypal', type: 'payout', text: 'Payout sent to diego@example.com (batch B1)' },
      { at: '', actor: 'agent', type: 'verified', text: 'AI reviewer verified every criterion: the secret menu has 6 items' },
      { at: '', actor: 'client', type: 'approved', text: 'Maya approved the work and released the payment: thanks for the private recipe' },
    ],
    access: newAccess(),
  } as unknown as Milestone;
  const v = viewerMilestone(full);
  const json = JSON.stringify(v);
  for (const secret of ['secret menu', 'private recipe', 'Secret brief', 'maya@example.com', 'diego@example.com', 'buyer@example.com', 'my work', 'x.example', 'a.png', 'saw it', full.access!.clientKey]) {
    assert.ok(!json.includes(secret), secret);
  }
  assert.equal(v.timeline[0].text, 'Payout sent to [email] (batch B1)');
  assert.equal(v.timeline[1].text, 'AI reviewer verified every criterion');
  assert.equal(v.timeline[2].text, 'Maya approved the work and released the payment');
  assert.equal(v.reviews[0].findings[0].status, 'met', 'verdicts stay visible');
  assert.equal(viewerMilestone({ ...full, description: '[Demo data] Design job.' }).description, '[Demo data] Design job.');
});
