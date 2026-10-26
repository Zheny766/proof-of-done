// Who may act on a milestone. The client and the freelancer each get their own secret link (a key
// in the URL); the server checks it on every action, and keys never leave the server inside
// milestone data.

import crypto from 'node:crypto';
import type { Milestone, MilestoneAccess, Role } from './types.ts';

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

/** The milestone as it may be sent to one of the two parties: everything except the keys. */
export function publicMilestone(m: Milestone): Milestone {
  const copy = { ...m };
  delete copy.access;
  return copy;
}

const EMAIL = /[^\s@()]+@[^\s@()]+\.[^\s@()]+/g;
export const redactEmails = (text: string) => text.replace(EMAIL, '[email]');

/**
 * What someone without either link sees: where the milestone stands, but not the brief, the
 * delivered work, the reviewer's evidence or anyone's email address.
 */
export function viewerMilestone(m: Milestone): Milestone {
  const p = publicMilestone(m);
  return {
    ...p,
    // Kept only for labelled demo data, so the list can still mark it as such.
    description: p.description.startsWith('[Demo data]') ? p.description : '',
    client: { name: p.client.name, email: '' },
    freelancer: { name: p.freelancer.name, email: '' },
    payment: { ...p.payment, payerEmail: undefined },
    submissions: p.submissions.map((s) => ({ ...s, notes: '', links: [], attachments: [] })),
    reviews: p.reviews.map((r) => ({ ...r, summary: undefined, feedback: undefined, log: [], findings: r.findings.map((f) => ({ ...f, evidence: '' })) })),
    timeline: p.timeline.map((e) => ({ ...e, text: redactEmails(e.text) })),
  };
}
