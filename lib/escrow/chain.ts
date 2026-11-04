// The deal's timeline as a hash chain: each step carries a SHA-256 of itself and the step before
// (the first one of the deal id), so changing, removing or reordering any past step breaks every
// hash after it. The last hash is the record's fingerprint: it goes to PayPal in the capture note
// and with dispute evidence, where nobody here can change it afterwards.
//
//   hash_0 = sha256(dealId + "\n" + at + "\n" + actor + "\n" + type + "\n" + text)
//   hash_n = sha256(hash_{n-1} + "\n" + at + "\n" + actor + "\n" + type + "\n" + text)
//
// scripts/verify-record.mjs checks a downloaded deal record the same way, offline.

import crypto from 'node:crypto';
import type { Milestone, TimelineEvent } from './types.ts';

export const linkHash = (prev: string, e: Pick<TimelineEvent, 'at' | 'actor' | 'type' | 'text'>) =>
  crypto.createHash('sha256').update([prev, e.at, e.actor, e.type, e.text].join('\n')).digest('hex');

/** Gives every step that has no hash yet its link; steps already sealed keep theirs, so an edit stays visible. */
export function sealTimeline(m: Milestone): void {
  let prev = m.id;
  for (const e of m.timeline) {
    e.hash ??= linkHash(prev, e);
    prev = e.hash;
  }
}

export type Seal = { head: string; events: number; intact: boolean; brokenAt?: number };

/** Recomputes the chain: intact when every stored hash matches the step it seals. */
export function checkSeal(m: Pick<Milestone, 'id' | 'timeline'>): Seal {
  const steps = m.timeline ?? [];
  let prev = m.id;
  for (const [i, e] of steps.entries()) {
    const expected = linkHash(prev, e);
    if (e.hash !== expected) return { head: steps.at(-1)?.hash ?? '', events: steps.length, intact: false, brokenAt: i };
    prev = expected;
  }
  return { head: prev === m.id ? '' : prev, events: steps.length, intact: true };
}
