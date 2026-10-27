import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowRequest, isCrossSite, withinDailyBudget } from '../lib/rate-limit.ts';

const from = (ip: string, headers: Record<string, string> = {}) => new Request('http://localhost/x', { headers: { 'x-forwarded-for': ip, ...headers } });

test('per-IP limit', () => {
  const results = Array.from({ length: 4 }, () => allowRequest(from('9.9.9.9'), 'per-ip', 3));
  assert.deepEqual(results, [true, true, true, false]);
  assert.equal(allowRequest(from('8.8.8.8'), 'per-ip', 3), true, 'another IP has its own allowance');
});

test('rotating fake X-Forwarded-For values still hit the shared cap', () => {
  let allowed = 0;
  for (let i = 0; i < 100; i++) if (allowRequest(from(`10.0.0.${i}`), 'spoof', 5)) allowed++;
  assert.equal(allowed, 20, 'shared cap is 4x the per-IP limit');
});

test('cross-site writes are recognised', () => {
  assert.equal(isCrossSite(from('1.1.1.1', { 'sec-fetch-site': 'cross-site' })), true);
  assert.equal(isCrossSite(from('1.1.1.1', { 'sec-fetch-site': 'same-origin' })), false);
  assert.equal(isCrossSite(from('1.1.1.1')), false, 'non-browser clients send no header');
});

test('a daily Claude budget is shared by everyone and starts over the next UTC day', () => {
  const day1 = Date.parse('2026-12-01T10:00:00Z');
  const results = Array.from({ length: 4 }, () => withinDailyBudget('daily-test', 3, day1));
  assert.deepEqual(results, [true, true, true, false]);
  assert.equal(withinDailyBudget('daily-test', 3, Date.parse('2026-12-01T23:59:00Z')), false, 'still the same day');
  assert.equal(withinDailyBudget('daily-test', 3, Date.parse('2026-12-02T00:01:00Z')), true, 'a new day');
  assert.equal(withinDailyBudget('other', 3, day1), true, 'each bucket counts on its own');
  assert.equal(withinDailyBudget('unset', 0, day1), true, 'no limit set: no cap');
});
