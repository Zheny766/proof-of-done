// Criteria the reviewer can't check from a delivery are flagged while the deal is written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criterionHint } from '../lib/escrow/criteria-lint.ts';

test('taste, opinions, open scope and unprovable claims are flagged, with the word that did it', () => {
  for (const [text, word] of [
    ['The site looks modern', 'modern'],
    ['The logo looks warm and friendly', 'warm'],
    ['A professional logo', 'professional'],
    ['The checkout is user-friendly', 'user-friendly'],
    ['The page is fast', 'fast'],
    ['The code is bug-free', 'bug-free'],
    ['The client is happy with the result', 'client is happy'],
    ['Icons, fonts, etc.', 'etc'],
    ['Works on all devices', 'all devices'],
    ['Logo', 'Logo'],
  ]) assert.equal(criterionHint(text)?.word, word, text);
});

test('criteria a reviewer can check pass, including the demo ones', () => {
  for (const text of [
    'One-page menu, delivered as a PDF',
    'At least 10 items, each with a price',
    'The EMBER & OAK logo is at the top',
    'Each description is 40 to 80 words',
    'No exclamation marks anywhere',
    'The page loads in under 2 s and is responsive at 375 px',
    'Includes captions',
    'All 4 unit tests pass when run with python3',
  ]) assert.equal(criterionHint(text), null, text);
});
