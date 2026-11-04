#!/usr/bin/env node
// Checks a deal record downloaded from a deal page ("Download the full record") without trusting
// this server: recomputes the timeline's hash chain (lib/escrow/chain.ts) and says whether every step
// is as it was when it happened, that the terms are the sealed ones, and whether it matches the fingerprint
// PayPal got with the capture (its invoice id, shown in PayPal's own transaction details).
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
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const link = (prev, e) => sha256([prev, e.at, e.actor, e.type, e.text, ...(e.state ? [e.state] : [])].join('\n'));

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

// The last step seals the terms; they must be the record's own criteria, amount, files and payee.
const last = record.timeline.at(-1);
const terms = record.seal?.terms;
if (ok && last?.state && terms) {
  const [amount, currency] = record.deal.amount.split(' ');
  const same =
    JSON.stringify(terms.criteria) === JSON.stringify(record.criteria.map((c) => c.text)) &&
    terms.amount === amount &&
    terms.currency === currency &&
    JSON.stringify(terms.files) === JSON.stringify(record.deliveries.flatMap((d) => d.files.map((f) => f.sha256 ?? ''))) &&
    terms.payee === record.freelancer.email;
  if (sha256(JSON.stringify(terms)) !== last.state || !same) {
    console.log("the deal's terms (criteria, amount, files or payee) are not the ones the last step sealed");
    ok = false;
  } else console.log(`the terms are the sealed ones: ${terms.criteria.length} ${terms.criteria.length === 1 ? "criterion" : "criteria"}, ${terms.amount} ${terms.currency}, ${terms.files.length} file(s)`);
}

// The capture note holds the fingerprint as it was at payment: it must be one of the chain's links.
const anchor = fromPayPal ?? record.seal?.anchoredAtPayPal;
if (anchor) {
  const at = record.timeline.findIndex((e) => e.hash?.startsWith(anchor));
  console.log(at >= 0 ? `PayPal's fingerprint ${anchor.slice(0, 16)} is step ${at + 1}: the history up to the payment is what PayPal saw` : `PayPal's fingerprint ${anchor.slice(0, 16)} is not in this record`);
  if (at < 0) ok = false;
}
process.exit(ok ? 0 : 1);
