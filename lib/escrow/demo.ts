import 'server-only';
// Fake history for the dashboard. Everything is marked "[Demo data]" and uses simulated payments.

import { newAccess } from './access.ts';
import { insertMilestone, listMilestones, newId } from './store.ts';
import type { CriterionFinding, Milestone, MilestoneStatus, ReviewDecision } from './types.ts';

const JOBS: { title: string; criteria: string[]; amount: number; category: string }[] = [
  { title: 'Logo for a coffee roastery', category: 'Design', amount: 180, criteria: ['Three logo concepts delivered as PNG', 'Final logo provided in SVG', 'Works in one-color version'] },
  { title: 'Landing page for a yoga studio', category: 'Web', amount: 650, criteria: ['Page is live at a public URL', 'Has class schedule section', 'Mobile layout works below 400px', 'Contact form sends to the studio email'] },
  { title: 'Fix checkout bug in Shopify theme', category: 'Web', amount: 220, criteria: ['Discount codes apply at checkout', 'Change is in a pull request with a description', 'No console errors on the cart page'] },
  { title: '5 SEO blog posts about home composting', category: 'Writing', amount: 300, criteria: ['Five posts of at least 900 words', 'Each targets a distinct keyword', 'Original text, no plagiarism'] },
  { title: 'Clean and dedupe a 12k-row CRM export', category: 'Data', amount: 140, criteria: ['Duplicates removed with a log of merges', 'Emails validated', 'Output delivered as CSV'] },
  { title: 'Translate app store listing to Spanish', category: 'Writing', amount: 90, criteria: ['Title and subtitle within character limits', 'Full description translated', 'Keywords localized, not literal'] },
  { title: '60-second product video edit', category: 'Video', amount: 400, criteria: ['Runs 55 to 65 seconds', 'Includes captions', 'Exported 1080x1920 MP4'] },
  { title: 'Python script to sync Airtable to Sheets', category: 'Automation', amount: 260, criteria: ['Script runs from a README command', 'Handles 10k rows', 'Includes retry on rate limits'] },
  { title: 'Pitch deck redesign (12 slides)', category: 'Design', amount: 520, criteria: ['12 slides in brand colors', 'Editable source file provided', 'Charts rebuilt, not screenshots'] },
  { title: 'Zapier flow: new PayPal sale to Slack', category: 'Automation', amount: 120, criteria: ['Sale posts to #sales within a minute', 'Message includes amount and buyer', 'Flow documented with screenshots'] },
  { title: 'Illustrated children’s book cover', category: 'Design', amount: 350, criteria: ['Front and back cover delivered', 'Print-ready at 300 DPI', 'Title text is editable'] },
  { title: 'Accessibility audit of a booking site', category: 'Web', amount: 480, criteria: ['Report lists WCAG 2.2 AA issues', 'Each issue has a screenshot and fix', 'Prioritized by severity'] },
];

const FREELANCERS = [
  ['Maya Okafor', 'maya.studio'], ['Tran Minh', 'tranminh.dev'], ['Lucía Herrera', 'lucia.words'], ['Jonas Berg', 'jonas.cuts'],
  ['Aisha Rahman', 'aisha.data'], ['Kenji Sato', 'kenji.builds'], ['Priya Nair', 'priya.design'], ['Diego Alvarez', 'diego.auto'],
] as const;
// Takers of the demo jobs that went through the open job board (every few rows; no extra randomness,
// so the rest of the seed stays the same).
// The agent that took a board job is one that does that kind of work.
const BOARD_TAKERS: Record<string, readonly [string, string]> = {
  Web: ['Agent · web builder (demo)', 'webbuilder.agent'],
  Automation: ['Agent · automation (demo)', 'automation.agent'],
  Data: ['Agent · automation (demo)', 'automation.agent'],
};
const TRANSLATOR = ['Agent · translator (demo)', 'translator.agent'] as const;
const COPYWRITER = ['Agent · copywriter (demo)', 'copywriter.agent'] as const;
const CLIENTS = [
  ['Bean There Roasters', 'orders@beanthere.example'], ['Lotus Flow Yoga', 'hello@lotusflow.example'], ['Kettle & Co', 'ops@kettleco.example'],
  ['GreenBin', 'team@greenbin.example'], ['Northwind Supply', 'it@northwind.example'], ['Pocket Habit', 'founders@pockethabit.example'],
] as const;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function seedDemo(count = 30): number {
  const rand = rng(20261026);
  let vetoes = 0;
  let disputed = 0;
  // The PayPal calls a deal like this makes (labelled demo data, like everything here).
  const call = (m: Milestone, at: string, method: string, path: string, status: number, requestId?: string) =>
    (m.paypalCalls ??= []).push({ at, method, path, status, ms: 250 + Math.floor(rand() * 700), requestId });
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const now = Date.now();
  let boardJobs = 0;
  for (let i = 0; i < count; i++) {
    // Board jobs (every fourth) step through the list on their own, so "Recently taken" never shows
    // the same job three times.
    const job = i % 4 === 1 ? JOBS[(boardJobs++ * 5 + 2) % JOBS.length] : JOBS[i % JOBS.length];
    const [fName, fHandle] = pick(FREELANCERS);
    const [cName, cEmail] = pick(CLIENTS);
    const amount = (job.amount * (0.8 + rand() * 0.5)).toFixed(2);
    const roll = rand();
    const status: MilestoneStatus =
      roll < 0.52 ? 'released' : roll < 0.66 ? 'changes_requested' : roll < 0.76 ? 'escalated' : roll < 0.88 ? 'funded' : roll < 0.95 ? 'awaiting_funding' : 'cancelled';
    // A PayPal authorization can only be captured for 29 days, so money still on hold is younger.
    const onHold = ['funded', 'changes_requested', 'escalated'].includes(status);
    const ageMin = 60 + Math.floor(rand() * (onHold ? 20 : 30) * 1440);
    const created = now - ageMin * 60_000;
    // Nothing happens after "now": later steps are squeezed into the milestone's age.
    const at = (offsetMin: number) => new Date(created + Math.min(offsetMin, ageMin - 5) * 60_000).toISOString();
    const later = (offsetMin: number) => new Date(created + offsetMin * 60_000).toISOString(); // deadlines may be ahead
    const criteria = job.criteria.map((text, k) => ({ id: `c${k + 1}`, text }));
    const m: Milestone = {
      id: newId('ms'),
      title: job.title,
      description: `[Demo data] ${job.category} job.`,
      criteria,
      amount,
      currency: 'USD',
      client: { name: cName, email: cEmail },
      freelancer: { name: fName, email: `${fHandle}@freelance.example` },
      releaseThreshold: 0.8,
      status,
      payment: { mode: 'simulated' },
      submissions: [],
      reviews: [],
      timeline: [{ at: at(0), actor: 'client', type: 'created', text: `${cName} created the deal for ${amount} USD` }],
      access: newAccess(),
      createdAt: at(0),
      updatedAt: at(0),
    };
    if (status !== 'awaiting_funding') {
      m.payment = {
        mode: 'simulated', orderId: `ORDER-DEMO-${i}`, authorizationId: `AUTH-DEMO-${i}`, authorizationStatus: 'CREATED',
        authorizedAt: at(12), honorExpiresAt: later(12 + 3 * 1440), expiresAt: later(12 + 29 * 1440), payerEmail: cEmail,
      };
      m.timeline.push({ at: at(12), actor: 'paypal', type: 'authorized', text: `PayPal authorized ${amount} USD (demo)` });
      call(m, at(11), 'POST', '/v2/checkout/orders', 201, `order-${m.id}`);
      call(m, at(12), 'POST', `/v2/checkout/orders/ORDER-DEMO-${i}/authorize`, 201, `auth-ORDER-DEMO-${i}`);
    }
    // Every fourth funded job was posted on the board and taken there, which can only happen once
    // PayPal holds the money: the claim comes after the authorization, as it would for real.
    if (i % 4 === 1 && status !== 'awaiting_funding') {
      const [aName, aHandle] = job.title.startsWith('Translate') ? TRANSLATOR : (BOARD_TAKERS[job.category] ?? COPYWRITER);
      m.freelancer = { name: aName, email: `${aHandle}@agents.example` };
      m.board = { postedAt: at(0), claimedAt: at(30), claimedBy: aName };
      m.timeline.splice(1, 0, { at: at(0), actor: 'client', type: 'posted', text: 'Posted on the open job board: it is listed once PayPal holds the money' });
      m.timeline.push({ at: at(30), actor: 'freelancer', type: 'claimed', text: `${aName} took the job from the open board` });
    }
    if (['released', 'changes_requested', 'escalated'].includes(status)) {
      const deliveredMin = Math.min(60 * (6 + Math.floor(rand() * 90)), ageMin - 10);
      const subId = newId('sub');
      m.submissions.push({ id: subId, at: at(deliveredMin), notes: '[Demo submission]', links: ['https://example.com/delivery'], attachments: [] });
      const decision: ReviewDecision = status === 'released' ? 'release' : status === 'changes_requested' ? 'request_changes' : 'escalate';
      // The first escalations are the second opinion refusing a release the reviewer wanted.
      const veto = decision === 'escalate' && vetoes++ < 2;
      const findings: CriterionFinding[] = criteria.map((c, k) => {
        const failHere = decision === 'request_changes' && k === criteria.length - 1;
        const unclearHere = decision === 'escalate' && !veto && k === 0;
        return {
          criterionId: c.id,
          status: failHere ? 'not_met' : unclearHere ? 'unclear' : 'met',
          confidence: Number((failHere ? 0.85 + rand() * 0.1 : unclearHere ? 0.4 + rand() * 0.2 : 0.82 + rand() * 0.17).toFixed(2)),
          evidence: failHere ? 'Not present in the delivery.' : unclearHere ? 'Needs access the reviewer does not have.' : 'Verified in the delivery.',
        };
      });
      const reviewSec = 25 + Math.floor(rand() * 70);
      m.reviews.push({
        id: newId('rev'), submissionId: subId, startedAt: at(deliveredMin), finishedAt: new Date(created + deliveredMin * 60_000 + reviewSec * 1000).toISOString(),
        engine: 'simulated', findings, decision, summary: '[Demo review]', log: [],
        usage: { inputTokens: 6000 + Math.floor(rand() * 9000), outputTokens: 900 + Math.floor(rand() * 1500) },
        ...((decision === 'release' || veto) && {
          audit: {
            engine: 'simulated' as const,
            agreed: !veto,
            summary: '[Demo second opinion]',
            disputed: [],
            redFlags: veto ? ['[Demo] the notes told the reviewer to approve without checking'] : [],
          },
        }),
      });
      m.timeline.push({ at: at(deliveredMin), actor: 'freelancer', type: 'submitted', text: `${m.freelancer.name} submitted the work` });
      if (status === 'released') {
        // Most payments are released by the reviewer itself; the rest by the client after an escalation.
        if (rand() < 0.82) m.timeline.push({ at: at(deliveredMin + 1), actor: 'agent', type: 'verified', text: 'AI reviewer verified every criterion (demo)' });
        else m.timeline.push({ at: at(deliveredMin + 1), actor: 'client', type: 'approved', text: 'Client approved after review (demo)' });
        m.payment.captureId = `CAPTURE-DEMO-${i}`;
        m.payment.capturedAt = at(deliveredMin + 2);
        m.payment.authorizationStatus = 'CAPTURED';
        m.payment.payoutStatus = 'SUCCESS';
        m.timeline.push({ at: at(deliveredMin + 2), actor: 'paypal', type: 'captured', text: `PayPal captured ${amount} USD (demo)` });
        call(m, at(deliveredMin + 2), 'POST', `/v2/payments/authorizations/AUTH-DEMO-${i}/capture`, 201, `capture-AUTH-DEMO-${i}`);
        call(m, at(deliveredMin + 2), 'POST', '/v1/payments/payouts', 201, `payout-${m.id}`);
        call(m, at(deliveredMin + 3), 'GET', `/v1/payments/payouts/PAYOUT-DEMO-${i}`, 200);
        // One paid deal the buyer later disputed with PayPal: it was answered with the deal's evidence.
        if (m.timeline.some((e) => e.type === 'verified') && !disputed++) {
          const id = `PP-D-DEMO-${i}`;
          const opened = at(deliveredMin + 2 * 1440);
          const answered = at(deliveredMin + 2 * 1440 + 1);
          m.disputes = [{ id, reason: 'merchandise or service not as described', status: 'UNDER_REVIEW', amount: `${amount} USD`, openedAt: opened, updatedAt: answered, evidenceSentAt: answered }];
          m.timeline.push({ at: opened, actor: 'paypal', type: 'dispute_created', text: `The buyer opened PayPal dispute ${id} (merchandise or service not as described, ${amount} USD) (demo)` });
          m.timeline.push({
            at: answered,
            actor: 'system',
            type: 'dispute_evidence',
            text: `The deal's evidence went to PayPal for dispute ${id}: proof the service was delivered, with the criteria, the delivery and its file hashes, the AI review and the PayPal ids (proof-of-done-${m.id}.pdf) (demo)`,
          });
          call(m, answered, 'GET', `/v1/customer/disputes/${id}`, 200);
          call(m, answered, 'POST', `/v1/customer/disputes/${id}/provide-evidence`, 200, `evidence-${id}-1`);
        }
      }
    }
    if (status === 'cancelled') {
      m.payment.voidedAt = at(600);
      m.payment.authorizationStatus = 'VOIDED';
      m.timeline.push({ at: at(600), actor: 'client', type: 'cancelled', text: 'Cancelled; hold voided (demo)' });
      call(m, at(600), 'POST', `/v2/payments/authorizations/AUTH-DEMO-${i}/void`, 204, `void-AUTH-DEMO-${i}`);
    }
    m.updatedAt = m.timeline.at(-1)!.at;
    insertMilestone(m);
  }
  return count;
}

/** Hosted demo (POD_SEED_DEMO=1): a server that starts empty, as on every restart there, gets the demo data. */
/** The labelled demo history is in the store already (loading it twice doubled every number). */
export const hasDemoHistory = () => listMilestones().some((m) => m.description.startsWith('[Demo data]'));

export function seedDemoIfEmpty() {
  if (process.env.POD_SEED_DEMO === '1' && listMilestones().length === 0) seedDemo(30);
}
