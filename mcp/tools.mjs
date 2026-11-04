// The Proof of Done tools for AI agents, shared by the local MCP server (mcp/proof-of-done.mjs, stdio)
// and the hosted one (app/api/mcp, Streamable HTTP). They call the public HTTP API, so an agent can
// do exactly what a person with the same link can do, and nothing more: funding needs the client in
// PayPal's own window, and a release still needs the policy check and the second opinion.

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml' };
const mimeOf = (name) => MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';

/** A deal link (https://host/m/ms_x?key=y) -> where to call and with which key. */
export function parseLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error('Pass the full deal link, like https://host/m/ms_1a2b3c4d5e6f?key=...');
  }
  const id = url.pathname.match(/\/m\/(ms_[\w-]+)/)?.[1];
  const key = url.searchParams.get('key');
  if (!id || !key) throw new Error('That link has no deal id or key. Use the private link from claim_job or from the client.');
  return { origin: url.origin, id, key };
}

async function call(origin, p, { key, body, form } = {}) {
  const res = await fetch(origin + p, {
    method: body || form ? 'POST' : 'GET',
    headers: { ...(key && { 'x-milestone-key': key }), ...(body && { 'Content-Type': 'application/json' }) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const text = (s) => ({ content: [{ type: 'text', text: s }] });

function describe(m, role, origin) {
  // A review made before the terms last changed was against the old criteria: it no longer counts.
  const last = m.reviews?.at(-1);
  const review = last && (!m.termsChangedAt || last.startedAt > m.termsChangedAt) ? last : undefined;
  const offer = m.termsChange;
  const verdicts = (review?.findings ?? []).reduce((acc, f) => ({ ...acc, [f.criterionId]: f }), {});
  return [
    `${m.title}: ${m.amount} ${m.currency}, ${m.client.name} pays ${m.freelancer.name}. You are the ${role}.`,
    m.dueAt && `Deadline: ${m.dueAt.slice(0, 16).replace('T', ' ')} UTC${Date.parse(m.dueAt) < Date.now() && ['funded', 'changes_requested'].includes(m.status) ? ' (passed)' : ''}.`,
    `Status: ${m.status}. PayPal: ${m.payment.authorizationStatus ? `authorization ${m.payment.authorizationStatus}` : 'not funded yet'}${m.payment.captureId ? `, captured ${m.payment.capturedAmount ?? m.amount}` : ''}${m.payment.payoutStatus ? `, payout ${m.payment.payoutStatus}` : ''}.`,
    m.description && `Brief: ${m.description}`,
    `Acceptance criteria (each must be met with at least ${Math.round(m.releaseThreshold * 100)}% confidence):`,
    ...m.criteria.map((c) => {
      const f = verdicts[c.id];
      return `- [${c.id}] ${c.text}${f ? ` -> ${f.status} ${Math.round(f.confidence * 100)}%: ${f.evidence}` : ''}`;
    }),
    review?.audit && `Second opinion: ${review.audit.agreed ? 'confirmed' : `refused (${[...review.audit.disputed.map((d) => `${d.criterionId}: ${d.reason}`), ...review.audit.redFlags].join('; ')})`}.`,
    review?.feedback && `Reviewer feedback: ${review.feedback}`,
    offer &&
      `Open offer to change the terms, from the ${offer.by}${offer.by === role ? ' (you; the other side accepts or declines)' : ' (accept or decline it with change_terms)'}: amount ${offer.to.amount} ${m.currency}, deadline ${offer.to.dueDays ? `${offer.to.dueDays} days after the hold` : 'none'}, criteria:\n${offer.to.criteria.map((c) => `  - ${c}`).join('\n')}${offer.note ? `\n  Why: ${offer.note}` : ''}`,
    m.complaint && `After the payment the client reported a problem and asks for ${m.complaint.amount} ${m.currency} back (${m.complaint.status})${m.complaint.text ? `: ${m.complaint.text}` : ''}.`,
    ...(m.disputes ?? []).map((d) => `PayPal dispute ${d.id} (${d.reason}, ${d.status.toLowerCase().replace(/_/g, ' ')}): ${d.evidenceSentAt ? `the deal's evidence went to PayPal on ${d.evidenceSentAt.slice(0, 10)}` : (d.evidenceNote ?? 'evidence not sent yet')}.`),
    m.payment.refunds?.length && `PayPal refunded to the client: ${m.payment.refunds.map((r) => `${r.amount} ${m.currency}`).join(', ')}.`,
    m.status === 'released' && origin && `Proof certificate (a public page anyone can open to check the payment and the delivered files' fingerprints): ${origin}/m/${m.id}/proof`,
  ]
    .filter(Boolean)
    .join('\n');
}

function describeJob(j) {
  return [
    `[${j.id}] ${j.title} - pays ${j.amount} ${j.currency} (${j.hold}; posted by ${j.client}${j.postedBy ? ` through ${j.postedBy}` : ''})`,
    j.description && `  Brief: ${j.description}`,
    `  Paid when every criterion is met with at least ${Math.round(j.releaseThreshold * 100)}% confidence:`,
    ...j.criteria.map((c) => `  - ${c}`),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Registers the tools on an McpServer. `base` is the Proof of Done server new jobs are posted to and
 * the board is read from (deal links carry their own host). `localFiles`: may submit_work read files
 * from this machine's disk (the local stdio server) or only take inline attachments (the hosted one).
 * The hosted one also follows deal links to its own host only: otherwise anyone could make the
 * server send requests wherever they like.
 */
export function registerTools(server, { base, localFiles = false, maxWaitSeconds = 600 }) {
  base = base.replace(/\/$/, '');
  const dealLink = (link) => {
    const deal = parseLink(link);
    if (!localFiles && deal.origin !== new URL(base).origin) throw new Error(`This server works with deals on ${base} only. For another host, connect its own MCP server.`);
    return deal;
  };

  server.registerTool(
    'find_jobs',
    {
      title: 'Find paid jobs',
      description:
        "List the open jobs on the Proof of Done job board. Each one is already paid for: the client's money is on hold with PayPal, and it is released to whoever delivers work that meets every acceptance criterion. Take one with claim_job.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { jobs } = await call(base, '/api/jobs');
      if (!jobs.length) return text('No open jobs right now.');
      const demo = jobs.some((j) => j.hold.startsWith('simulated'))
        ? '\n\nJobs marked "simulated hold (demo)" are practice jobs: the hold and the payout are simulated, and when one is taken a fresh copy is posted for the next agent.'
        : '';
      return text(`${jobs.length} open job(s):\n\n${jobs.map(describeJob).join('\n\n')}${demo}`);
    },
  );

  server.registerTool(
    'claim_job',
    {
      title: 'Take a job',
      description:
        'Take an open job from the board. Nobody else can take it while you work on it (24 hours to deliver). Returns your private freelancer link: use it with submit_work and wait_for_verdict. The payout goes to the PayPal email you give here; your track record is kept against that email, and a poor one (held deliveries, an attempt to steer the reviewer) means the client approves your payments and you can hold fewer jobs at once.',
      inputSchema: {
        job_id: z.string().regex(/^ms_[\w-]+$/).describe('The job id from find_jobs, like ms_1a2b3c4d5e6f'),
        name: z.string().min(1).max(80).describe('Who is doing the work, e.g. "Claude Code agent for Jane Doe"'),
        payout_email: z.string().email().describe('PayPal email the payment goes to'),
      },
    },
    async ({ job_id, name, payout_email }) => {
      const { job, link, standing } = await call(base, `/api/jobs/${job_id}/claim`, { body: { name, payoutEmail: payout_email } });
      const note =
        standing?.tier === 'probation'
          ? `Your standing: probation (${standing.reason}). Even if the work passes, the client has to approve the payment.`
          : standing && `Your standing: ${standing.tier} (${standing.reason}).`;
      return text([`You took "${job.title}" for ${job.amount} ${job.currency}.`, `Your private freelancer link (keep it to yourself): ${link}`, note, '', describeJob(job)].filter((l) => l !== undefined).join('\n'));
    },
  );

  server.registerTool(
    'post_job',
    {
      title: 'Post a job with PayPal escrow',
      description:
        'Create a Proof of Done deal: the brief, checkable acceptance criteria and the amount. Returns the client link, which a human opens to approve the payment in PayPal (nothing is charged until the work is verified). With open_to_agents the funded job goes on the public board for any agent or person to take; otherwise you also get a freelancer link to send to someone.',
      inputSchema: {
        title: z.string().min(3).max(120),
        description: z.string().max(4000).default(''),
        criteria: z.array(z.string().min(3).max(300)).min(1).max(12).describe('Objectively checkable acceptance criteria'),
        amount_usd: z.number().min(1).max(10000),
        client_name: z.string().describe('The person or business paying; they approve the payment in PayPal'),
        client_email: z.string().email(),
        posted_by: z.string().min(1).max(80).describe('Your own name as the agent posting this, e.g. "Claude Code for Maya"'),
        open_to_agents: z.boolean().default(false).describe('Post it on the open job board instead of naming a freelancer'),
        freelancer_name: z.string().optional(),
        freelancer_email: z.string().email().optional().describe('Where the payout goes; the freelancer can change it when delivering'),
        objection_hours: z.number().int().min(0).max(48).default(0).describe('Hours the client gets to object after the AI verifies, before the money moves'),
        due_days: z.number().int().min(1).max(25).optional().describe('Deadline in days, counted from when PayPal holds the money (not for jobs on the open board)'),
        stages: z
          .array(z.object({ title: z.string().min(3).max(120), amount_usd: z.number().min(1).max(10000), days: z.number().int().min(1).max(25).default(7).describe('Planned length of the stage in days, also its deadline once funded'), criteria: z.array(z.string().min(3).max(300)).min(1).max(12) }))
          .min(2)
          .max(6)
          .optional()
          .describe('For a bigger job: 2-6 stages, each with its own amount and criteria, funded when it starts and paid when it passes (then amount_usd and criteria are ignored; needs a named freelancer)'),
      },
    },
    async (a) => {
      if (a.stages) {
        const { milestones, clientKey, freelancerKey } = await call(base, '/api/escrow/projects', {
          body: {
            title: a.title, description: a.description, clientName: a.client_name, clientEmail: a.client_email, freelancerName: a.freelancer_name, freelancerEmail: a.freelancer_email,
            objectionHours: a.objection_hours, postedBy: a.posted_by, stages: a.stages.map((st) => ({ title: st.title, amount: st.amount_usd, days: st.days, criteria: st.criteria })),
          },
        });
        const first = milestones[0];
        return text(
          [
            `Posted the project "${a.title}" in ${milestones.length} stages: ${milestones.map((m) => `${m.amount} USD`).join(', ')}.`,
            `Give this link to ${a.client_name}: they approve stage 1 in PayPal, and each later stage when it starts: ${base}/m/${first.id}?key=${clientKey}`,
            `Freelancer link (the same for every stage): ${base}/m/${first.id}?key=${freelancerKey}`,
          ].join('\n'),
        );
      }
      const { milestone, clientKey, freelancerKey, criteriaHints = [] } = await call(base, '/api/escrow/milestones', {
        body: {
          title: a.title, description: a.description, criteria: a.criteria, amount: a.amount_usd, clientName: a.client_name, clientEmail: a.client_email,
          postToBoard: a.open_to_agents, freelancerName: a.freelancer_name, freelancerEmail: a.freelancer_email, objectionHours: a.objection_hours, postedBy: a.posted_by, dueDays: a.due_days,
        },
      });
      return text(
        [
          `Posted "${milestone.title}" for ${milestone.amount} USD.`,
          `Give this link to ${a.client_name}: they open it, check the brief and approve the payment in PayPal (nothing is charged until the work passes): ${base}/m/${milestone.id}?key=${clientKey}`,
          a.open_to_agents ? 'Once PayPal holds the money it is listed on the open job board.' : `Freelancer link (send it to whoever does the work): ${base}/m/${milestone.id}?key=${freelancerKey}`,
          ...(criteriaHints.length ? ['', 'The reviewer may not be able to check these criteria; consider posting again with sharper ones:', ...criteriaHints.map((h) => `- ${h}`)] : []),
        ].join('\n'),
      );
    },
  );

  server.registerTool(
    'get_job',
    {
      title: 'Read a job',
      description: 'Read a Proof of Done deal through its private link: the brief, the acceptance criteria, whether PayPal holds the money, and the latest verdict and feedback.',
      inputSchema: { link: z.string().describe('The private deal link, https://host/m/ms_...?key=...') },
      annotations: { readOnlyHint: true },
    },
    async ({ link }) => {
      const { origin, id, key } = dealLink(link);
      const { milestone, role } = await call(origin, `/api/escrow/milestones/${id}`, { key });
      return text(describe(milestone, role, origin));
    },
  );

  const attachment = z.object({
    name: z.string().min(1).max(120).describe('File name with extension, e.g. menu-es.md'),
    content: z.string().max(200_000).optional().describe('The file as text'),
    content_base64: z.string().max(14_000_000).optional().describe('The file as base64, for PDFs and images'),
  });
  server.registerTool(
    'submit_work',
    {
      title: 'Deliver the work',
      description:
        'Deliver work on a funded deal with your freelancer link: notes on how each criterion is met, links, and files. An AI reviewer then checks it against every criterion; if all are met and a second model agrees, PayPal pays out. Call wait_for_verdict next.',
      inputSchema: {
        link: z.string().describe('Your freelancer link'),
        notes: z.string().max(10000).describe('What you delivered and how it meets each criterion'),
        links: z.array(z.string().url()).max(10).default([]),
        attachments: z.array(attachment).max(8).default([]).describe('Files, sent inline'),
        ...(localFiles && { files: z.array(z.string()).max(8).default([]).describe('Absolute paths of local files to attach') }),
        payout_email: z.string().email().optional().describe('PayPal email for the payout, if not the one on the deal'),
      },
    },
    async ({ link, notes, links, attachments, files = [], payout_email }) => {
      const { origin, id, key } = dealLink(link);
      const form = new FormData();
      form.set('notes', notes);
      form.set('links', links.join('\n'));
      if (payout_email) form.set('payoutEmail', payout_email);
      for (const a of attachments) {
        if (a.content === undefined && a.content_base64 === undefined) throw new Error(`${a.name}: give content or content_base64`);
        const bytes = a.content_base64 !== undefined ? Buffer.from(a.content_base64, 'base64') : Buffer.from(a.content, 'utf8');
        form.append('files', new Blob([bytes], { type: mimeOf(a.name) }), path.basename(a.name));
      }
      for (const file of files) {
        const stat = fs.statSync(file, { throwIfNoEntry: false });
        if (!stat?.isFile()) throw new Error(`No such file: ${file}`);
        if (stat.size > 15 * 1024 * 1024) throw new Error(`${path.basename(file)} is larger than 15 MB`);
        form.append('files', new Blob([fs.readFileSync(file)], { type: mimeOf(file) }), path.basename(file));
      }
      await call(origin, `/api/escrow/milestones/${id}/submit`, { key, form });
      return text('Delivered. The AI reviewer is checking it now; call wait_for_verdict with the same link.');
    },
  );

  server.registerTool(
    'change_terms',
    {
      title: 'Change the terms',
      description:
        'Offer the other side new terms on a deal (new acceptance criteria, a lower amount, another deadline), or accept or decline their offer. Nothing changes until the other side accepts. Once PayPal holds the money the amount can only go down: PayPal captures the new amount and the rest of the hold goes back to the client. Possible before the work is delivered, or after a review asked for changes.',
      inputSchema: {
        link: z.string().describe('Your client or freelancer link'),
        action: z.enum(['propose', 'accept', 'decline']).describe('decline also withdraws your own offer'),
        criteria: z.array(z.string().min(3).max(300)).min(1).max(12).optional().describe('propose: the full new list of acceptance criteria (default: unchanged)'),
        amount: z.number().min(1).max(10000).optional().describe('propose: the new amount in USD (default: unchanged)'),
        due_days: z.number().int().min(1).max(25).optional().describe('propose: deadline in days after PayPal holds the money (default: unchanged)'),
        note: z.string().max(500).optional().describe('propose: why the terms change'),
      },
    },
    async ({ link, action, criteria, amount, due_days, note }) => {
      const { origin, id, key } = dealLink(link);
      let body = { action };
      if (action === 'propose') {
        const { milestone: now } = await call(origin, `/api/escrow/milestones/${id}`, { key });
        body = { action, criteria: criteria ?? now.criteria.map((c) => c.text), amount: amount ?? Number(now.amount), dueDays: due_days ?? now.dueDays, note };
      }
      const { milestone } = await call(origin, `/api/escrow/milestones/${id}/terms`, { key, body });
      const { role } = await call(origin, `/api/escrow/milestones/${id}`, { key });
      return text(describe(milestone, role, origin));
    },
  );

  server.registerTool(
    'wait_for_verdict',
    {
      title: 'Wait for the verdict',
      description: 'Wait until the AI review of the latest delivery has finished, then report the outcome: paid, verified (paid after the objection window), changes requested with feedback, or handed to the client.',
      inputSchema: { link: z.string(), timeout_seconds: z.number().int().min(10).max(maxWaitSeconds).default(Math.min(240, maxWaitSeconds)) },
      annotations: { readOnlyHint: true },
    },
    async ({ link, timeout_seconds }) => {
      const { origin, id, key } = dealLink(link);
      const until = Date.now() + timeout_seconds * 1000;
      for (;;) {
        const { milestone, role } = await call(origin, `/api/escrow/milestones/${id}`, { key });
        // The decision changes the status first; the verdict's summary lands a moment later.
        if (milestone.status !== 'reviewing' && (milestone.reviews?.at(-1)?.finishedAt || Date.now() > until)) return text(describe(milestone, role, origin));
        if (Date.now() > until) return text('Still reviewing; call wait_for_verdict again.');
        await new Promise((r) => setTimeout(r, 3000));
      }
    },
  );
}
