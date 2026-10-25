import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReleasePolicy, latestFindings } from '../lib/escrow/policy.ts';

const criteria = [
  { id: 'c1', text: 'Page is live' },
  { id: 'c2', text: 'Has a schedule' },
];

test('releases only when every criterion is met above the threshold', () => {
  const ok = checkReleasePolicy(criteria, [
    { criterionId: 'c1', status: 'met', confidence: 0.9, evidence: '' },
    { criterionId: 'c2', status: 'met', confidence: 0.85, evidence: '' },
  ], 0.8);
  assert.equal(ok.ok, true);
});

test('blocks a missing finding', () => {
  const r = checkReleasePolicy(criteria, [{ criterionId: 'c1', status: 'met', confidence: 0.95, evidence: '' }], 0.8);
  assert.equal(r.ok, false);
  assert.match(r.reasons[0], /No finding/);
});

test('blocks low confidence even when the model says met', () => {
  const r = checkReleasePolicy(criteria, [
    { criterionId: 'c1', status: 'met', confidence: 0.95, evidence: '' },
    { criterionId: 'c2', status: 'met', confidence: 0.6, evidence: '' },
  ], 0.8);
  assert.equal(r.ok, false);
  assert.match(r.reasons[0], /below/);
});

test('blocks not_met and unclear', () => {
  const r = checkReleasePolicy(criteria, [
    { criterionId: 'c1', status: 'not_met', confidence: 0.99, evidence: '' },
    { criterionId: 'c2', status: 'unclear', confidence: 0.99, evidence: '' },
  ], 0.8);
  assert.equal(r.reasons.length, 2);
});

test('the latest finding for a criterion wins', () => {
  const findings = [
    { criterionId: 'c1', status: 'not_met' as const, confidence: 0.9, evidence: 'first look' },
    { criterionId: 'c1', status: 'met' as const, confidence: 0.92, evidence: 'second look' },
    { criterionId: 'c2', status: 'met' as const, confidence: 0.9, evidence: '' },
  ];
  assert.equal(checkReleasePolicy(criteria, findings, 0.8).ok, true);
  assert.equal(latestFindings(criteria, findings)[0]?.evidence, 'second look');
});
