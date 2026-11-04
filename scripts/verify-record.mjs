#!/usr/bin/env node
// Checks a deal record downloaded from a deal page ("Download the full record") without trusting
// this server: recomputes the timeline's hash chain (lib/escrow/chain.ts) and says whether every step
// is as it was when it happened, and whether it matches the fingerprint PayPal got in the capture note.
//
//   node scripts/verify-record.mjs proof-of-done-ms_xxxx.json [fingerprint from PayPal]

import crypto from 'node:crypto';
import fs from 'node:fs';

const [file, fromPayPal] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/verify-record.mjs <record.json> [fingerprint from PayPal]');
  process.exit(2);
}
const record = JSON.parse(fs.readFileSync(file, 'utf8'));
const link = (prev, e) => crypto.createHash('sha256').update([prev, e.at, e.actor, e.type, e.text].join('\n')).digest('hex');

let prev = record.deal.id;
let ok = true;
for (const [i, e] of record.timeline.entries()) {
  const expected = link(prev, e);
  if (e.hash !== expected) {
    console.log(`step ${i + 1} (${e.at}, ${e.type}) does not match its hash: the record was changed from here on`);
    ok = false;
    break;
  }
  prev = expected;
}
if (ok) console.log(`all ${record.timeline.length} steps check out; fingerprint ${prev}`);

// The capture note holds the fingerprint as it was at payment: it must be one of the chain's links.
const anchor = fromPayPal ?? record.seal?.anchoredAtPayPal;
if (anchor) {
  const at = record.timeline.findIndex((e) => e.hash?.startsWith(anchor));
  console.log(at >= 0 ? `PayPal's fingerprint ${anchor.slice(0, 16)} is step ${at + 1}: the history up to the payment is what PayPal saw` : `PayPal's fingerprint ${anchor.slice(0, 16)} is not in this record`);
  if (at < 0) ok = false;
}
process.exit(ok ? 0 : 1);
