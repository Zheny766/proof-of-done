// Who may act on a milestone. The client and the freelancer each get their own secret link (a key
// in the URL); the server checks it on every action, and keys never leave the server inside
// milestone data.

import crypto from 'node:crypto';
import type { Milestone, MilestoneAccess, Role } from './types';

export const newAccess = (): MilestoneAccess => ({
  clientKey: crypto.randomBytes(18).toString('base64url'),
  freelancerKey: crypto.randomBytes(18).toString('base64url'),
});

function sameKey(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function roleFor(m: Milestone, key: string | null | undefined): Role {
  if (!key || !m.access) return 'viewer';
  if (sameKey(key, m.access.clientKey)) return 'client';
  if (sameKey(key, m.access.freelancerKey)) return 'freelancer';
  return 'viewer';
}

/** The milestone as it may be sent to a browser: without the keys. */
export function publicMilestone(m: Milestone): Milestone {
  const copy = { ...m };
  delete copy.access;
  return copy;
}
