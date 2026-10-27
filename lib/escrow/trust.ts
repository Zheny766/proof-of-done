// Standing of whoever gets paid, keyed by the PayPal email the money goes to (that is the identity
// that matters to a payment). It only counts what the reviewer decided, never what the taker says.

import { listMilestones } from './store.ts';
import type { Milestone } from './types.ts';

export type TrustTier = 'new' | 'regular' | 'trusted' | 'probation';
export type Trust = { tier: TrustTier; decided: number; paid: number; flagged: number; reason: string };

const RED_FLAG_DAYS = 30;
// The demo scenarios share placeholder identities (and the challenge must show what the AI does on its
// own), so they neither count towards nor get a standing. Board jobs taken by visitors' agents do.
export const scripted = (m: Milestone) => !!m.demo && m.demo.scenario !== 'board';
export const CLAIM_LIMIT: Record<TrustTier, number> = { probation: 1, new: 2, regular: 3, trusted: 5 };

/** `all`: the milestones to count from, when the caller already loaded them (each load reads the store). */
export function trustFor(email: string, exceptId?: string, all: Milestone[] = listMilestones()): Trust {
  const who = email.trim().toLowerCase();
  const since = Date.now() - RED_FLAG_DAYS * 86_400_000;
  let decided = 0;
  let paid = 0;
  let flagged = 0;
  for (const m of all) {
    if (m.id === exceptId || !who || scripted(m) || m.freelancer.email.toLowerCase() !== who) continue;
    const finished = m.reviews.filter((r) => r.finishedAt);
    if (finished.some((r) => r.audit?.redFlags.length && Date.parse(r.finishedAt!) > since)) flagged++;
    if (!finished.length || !['released', 'changes_requested', 'escalated', 'cancelled'].includes(m.status)) continue;
    decided++;
    if (m.status === 'released') paid++;
  }
  const held = decided - paid;
  if (flagged) return { tier: 'probation', decided, paid, flagged, reason: `the second opinion flagged an attempt to steer the reviewer in the last ${RED_FLAG_DAYS} days` };
  if (decided >= 2 && paid / decided < 0.5) return { tier: 'probation', decided, paid, flagged, reason: `${held} of ${decided} deliveries were held` };
  if (paid >= 3 && paid / decided >= 0.8) return { tier: 'trusted', decided, paid, flagged, reason: `${paid} of ${decided} deliveries paid after review` };
  if (decided < 2) return { tier: 'new', decided, paid, flagged, reason: 'fewer than 2 reviewed deliveries' };
  return { tier: 'regular', decided, paid, flagged, reason: `${paid} of ${decided} deliveries paid after review` };
}

