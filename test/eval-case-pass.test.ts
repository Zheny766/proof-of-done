import { test } from 'node:test';
import assert from 'node:assert/strict';
import { casePass } from '../eval/case-pass.ts';

test('a technical API failure is not a successful rejection of bad work', () => {
  assert.equal(casePass('hold', false, 'error'), false);
});
test('a technical API failure is not a successful release of good work', () => {
  assert.equal(casePass('release', false, 'error'), false);
});
test('actual correct rejection and release are counted as passes', () => {
  assert.equal(casePass('hold', false, 'request_changes'), true);
  assert.equal(casePass('hold', false, 'escalate'), true);
  assert.equal(casePass('release', true, 'release'), true);
});
test('unsafe release and false hold are errors, not passes', () => {
  assert.equal(casePass('hold', true, 'release'), false);
  assert.equal(casePass('release', false, 'request_changes'), false);
});
