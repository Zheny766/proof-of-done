#!/usr/bin/env node
// Proof of Done as an MCP server: an AI agent can post a job (a human approves the payment in PayPal)
// or do one (deliver through the freelancer's link and get paid when the reviewer verifies the work).
// The agent never touches money directly: funding needs the client in PayPal's own window, and a
// release still needs the policy check and the second opinion on the server.
//
//   Claude Code:  claude mcp add proof-of-done -- node /path/to/proof-of-done/mcp/proof-of-done.mjs
//   POD_BASE_URL  where new jobs are posted (default http://localhost:3000); links carry their own host.

import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.POD_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml' };

/** A deal link (https://host/m/ms_x?key=y) -> where to call and with which key. */
function parseLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error('Pass the full deal link, like https://host/m/ms_1a2b3c4d5e6f?key=...');
  }
  const id = url.pathname.match(/\/m\/(ms_[\w-]+)/)?.[1];
  const key = url.searchParams.get('key');
  if (!id || !key) throw new Error('That link has no deal id or key. Use the private link the client sent.');
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

function describe(m, role) {
  const review = m.reviews?.at(-1);
  const verdicts = (review?.findings ?? []).reduce((acc, f) => ({ ...acc, [f.criterionId]: f }), {});
  return [
    `${m.title}: ${m.amount} ${m.currency}, ${m.client.name} pays ${m.freelancer.name}. You are the ${role}.`,
    `Status: ${m.status}. PayPal: ${m.payment.authorizationStatus ? `authorization ${m.payment.authorizationStatus}` : 'not funded yet'}${m.payment.captureId ? `, captured ${m.payment.capturedAmount ?? m.amount}` : ''}${m.payment.payoutStatus ? `, payout ${m.payment.payoutStatus}` : ''}.`,
    m.description && `Brief: ${m.description}`,
    `Acceptance criteria (each must be met with at least ${Math.round(m.releaseThreshold * 100)}% confidence):`,
    ...m.criteria.map((c) => {
      const f = verdicts[c.id];
      return `- [${c.id}] ${c.text}${f ? ` -> ${f.status} ${Math.round(f.confidence * 100)}%: ${f.evidence}` : ''}`;
    }),
    review?.audit && `Second opinion: ${review.audit.agreed ? 'confirmed' : `refused (${[...review.audit.disputed.map((d) => `${d.criterionId}: ${d.reason}`), ...review.audit.redFlags].join('; ')})`}.`,
    review?.feedback && `Reviewer feedback: ${review.feedback}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const server = new McpServer({ name: 'proof-of-done', version: '1.0.0' });

server.registerTool(
  'post_job',
  {
    title: 'Post a job with PayPal escrow',
    description:
      'Create a Proof of Done deal: the brief, checkable acceptance criteria and the amount. Returns two private links: the client link, which a human opens to approve the payment in PayPal (nothing is charged until the work is verified), and the freelancer link, which is all a freelancer (human or agent) needs to deliver.',
    inputSchema: {
      title: z.string().min(3).max(120),
      description: z.string().max(4000).default(''),
      criteria: z.array(z.string().min(3).max(300)).min(1).max(12).describe('Objectively checkable acceptance criteria'),
      amount_usd: z.number().min(1).max(10000),
      client_name: z.string(),
      client_email: z.string().email(),
      freelancer_name: z.string(),
      freelancer_email: z.string().email().describe('Where the payout goes; the freelancer can change it when delivering'),
      objection_hours: z.number().int().min(0).max(48).default(0).describe('Hours the client gets to object after the AI verifies, before the money moves'),
    },
  },
  async (a) => {
    const { milestone, clientKey, freelancerKey } = await call(BASE, '/api/escrow/milestones', {
      body: { title: a.title, description: a.description, criteria: a.criteria, amount: a.amount_usd, clientName: a.client_name, clientEmail: a.client_email, freelancerName: a.freelancer_name, freelancerEmail: a.freelancer_email, objectionHours: a.objection_hours },
    });
    return text(
      [
        `Posted "${milestone.title}" for ${milestone.amount} USD.`,
        `Client link (a human opens it and approves the payment in PayPal): ${BASE}/m/${milestone.id}?key=${clientKey}`,
        `Freelancer link (send it to whoever does the work): ${BASE}/m/${milestone.id}?key=${freelancerKey}`,
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
    const { origin, id, key } = parseLink(link);
    const { milestone, role } = await call(origin, `/api/escrow/milestones/${id}`, { key });
    return text(describe(milestone, role));
  },
);

server.registerTool(
  'submit_work',
  {
    title: 'Deliver the work',
    description:
      'Deliver work on a funded deal with the freelancer link: notes on how each criterion is met, links, and local files (PDF, images, text, code). An AI reviewer then checks it against every criterion; if all are met and a second model agrees, PayPal pays out. Call wait_for_verdict next.',
    inputSchema: {
      link: z.string().describe('The freelancer link'),
      notes: z.string().max(10000).describe('What you delivered and how it meets each criterion'),
      links: z.array(z.string().url()).max(10).default([]),
      files: z.array(z.string()).max(8).default([]).describe('Absolute paths of local files to attach'),
      payout_email: z.string().email().optional().describe('PayPal email for the payout, if not the one on the deal'),
    },
  },
  async ({ link, notes, links, files, payout_email }) => {
    const { origin, id, key } = parseLink(link);
    const form = new FormData();
    form.set('notes', notes);
    form.set('links', links.join('\n'));
    if (payout_email) form.set('payoutEmail', payout_email);
    for (const file of files) {
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (!stat?.isFile()) throw new Error(`No such file: ${file}`);
      if (stat.size > 15 * 1024 * 1024) throw new Error(`${path.basename(file)} is larger than 15 MB`);
      form.append('files', new Blob([fs.readFileSync(file)], { type: MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' }), path.basename(file));
    }
    await call(origin, `/api/escrow/milestones/${id}/submit`, { key, form });
    return text('Delivered. The AI reviewer is checking it now; call wait_for_verdict with the same link.');
  },
);

server.registerTool(
  'wait_for_verdict',
  {
    title: 'Wait for the verdict',
    description: 'Wait until the AI review of the latest delivery has finished, then report the outcome: paid, verified (paid after the objection window), changes requested with feedback, or handed to the client.',
    inputSchema: { link: z.string(), timeout_seconds: z.number().int().min(10).max(600).default(240) },
    annotations: { readOnlyHint: true },
  },
  async ({ link, timeout_seconds }) => {
    const { origin, id, key } = parseLink(link);
    const until = Date.now() + timeout_seconds * 1000;
    for (;;) {
      const { milestone, role } = await call(origin, `/api/escrow/milestones/${id}`, { key });
      if (milestone.status !== 'reviewing') return text(describe(milestone, role));
      if (Date.now() > until) return text('Still reviewing; call wait_for_verdict again.');
      await new Promise((r) => setTimeout(r, 3000));
    }
  },
);

await server.connect(new StdioServerTransport());
