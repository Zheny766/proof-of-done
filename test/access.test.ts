import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAccess, publicMilestone, roleFor } from '../lib/escrow/access.ts';
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
