// The deal's timeline as a hash chain: each step carries a SHA-256 of itself and the step before
// (the first one of the deal id), so changing, removing or reordering any past step breaks every
// hash after it. Each step also seals the deal's terms as they stood then (criteria, amount, the
// delivered files' SHA-256s, who gets paid): changing those without a step that says so shows too.
// The last hash is the record's fingerprint: it goes to PayPal with the capture (as its invoice id,
// which PayPal returns, and in the note to the payer) and with dispute evidence.
//
//   state  = sha256(JSON of { criteria, amount, currency, files, payee })
//   hash_0 = sha256(dealId + "\n" + at + "\n" + actor + "\n" + type + "\n" + text [+ "\n" + state])
//   hash_n = sha256(hash_{n-1} + "\n" + ...the same fields)
//
// scripts/verify-record.mjs checks a downloaded deal record the same way, offline.

import crypto from 'node:crypto';
import type { Milestone, TimelineEvent } from './types.ts';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const linkHash = (prev: string, e: Pick<TimelineEvent, 'at' | 'actor' | 'type' | 'text' | 'state'>) =>
  sha256([prev, e.at, e.actor, e.type, e.text, ...(e.state ? [e.state] : [])].join('\n'));

type Terms = Pick<Milestone, 'criteria' | 'amount' | 'currency' | 'submissions' | 'freelancer'>;

/** The terms a step seals, in a fixed shape (the deal record carries the same object). */
export const sealedTerms = (m: Terms) => ({
  criteria: m.criteria.map((c) => (c.judge === 'client' ? `${c.text} [client judges]` : c.text)),
  amount: m.amount,
  currency: m.currency,
  files: m.submissions.flatMap((s) => s.attachments.map((a) => a.sha256 ?? '')),
  payee: m.freelancer.email,
});
export const termsDigest = (terms: ReturnType<typeof sealedTerms>) => sha256(JSON.stringify(terms));

/** Gives every step that has no hash yet its link; steps already sealed keep theirs, so an edit stays visible. */
export function sealTimeline(m: Milestone): void {
  let prev = m.id;
  for (const e of m.timeline) {
    if (!e.hash) {
      if (m.criteria && m.submissions && m.freelancer) e.state = termsDigest(sealedTerms(m));
      e.hash = linkHash(prev, e);
    }
    prev = e.hash;
  }
}

export type Seal = { head: string; events: number; intact: boolean; brokenAt?: number; termsChanged?: boolean };

/**
 * Recomputes the chain: intact when every stored hash matches the step it seals, and the deal's
 * terms now are the ones the last step sealed.
 */
export function checkSeal(m: Pick<Milestone, 'id' | 'timeline'> & Partial<Terms>): Seal {
  const steps = m.timeline ?? [];
  let prev = m.id;
  for (const [i, e] of steps.entries()) {
    const expected = linkHash(prev, e);
    if (e.hash !== expected) return { head: steps.at(-1)?.hash ?? '', events: steps.length, intact: false, brokenAt: i };
    prev = expected;
  }
  const last = steps.at(-1);
  if (last?.state && m.criteria && m.submissions && m.freelancer && last.state !== termsDigest(sealedTerms(m as Terms))) {
    return { head: prev, events: steps.length, intact: false, termsChanged: true };
  }
  return { head: prev === m.id ? '' : prev, events: steps.length, intact: true };
}
