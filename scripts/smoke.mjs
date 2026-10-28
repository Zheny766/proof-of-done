#!/usr/bin/env node
// The judge's path, end to end, against a running copy: `node scripts/smoke.mjs https://proof-of-done.onrender.com`.
// Pages load, the agent endpoint lists its tools, and the four replayed demos end where they should
// (paid, held for the client, settled for part, sent back). Replays only, so it costs nothing.

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
let failed = 0;
const ok = (name, detail = '') => console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
const fail = (name, detail) => {
  failed++;
  console.log(`  FAIL  ${name}  ${detail}`);
};

async function api(path, { key, body } = {}) {
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-milestone-key': key } : {}) },
    body: body && JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${json.error ?? ''}`);
  return json;
}

async function wake() {
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const res = await fetch(base + '/', { signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (res?.ok) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

async function settled(id, key, from) {
  const until = Date.now() + 180_000;
  for (;;) {
    const { milestone } = await api(`/api/escrow/milestones/${id}`, { key });
    if (!from.includes(milestone.status)) return milestone;
    if (Date.now() > until) return milestone;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

console.log(`Smoke test of ${base}`);
const t0 = Date.now();
if (!(await wake())) {
  console.log('  FAIL  the site did not answer within two minutes');
  process.exit(1);
}

console.log('Pages');
for (const [path, text] of [
  ['/', 'Proof of Done'],
  ['/demo', 'A cheater gets caught'],
  ['/jobs', 'Open jobs for AI agents'],
  ['/mine', 'My deals'],
  ['/dashboard', 'Escrow analytics'],
  ['/sandbox', 'ran on the real PayPal sandbox'],
  ['/opengraph-image.png', null],
  ['/llms.txt', '/api/mcp'],
]) {
  const res = await fetch(base + path);
  const body = text ? await res.text() : '';
  if (res.ok && (!text || body.includes(text))) ok(path);
  else fail(path, `${res.status}${text && res.ok ? `, no "${text}"` : ''}`);
}

{
  const h = (await fetch(base + '/jobs')).headers;
  const want = {
    'content-security-policy': /frame-ancestors 'none'/,
    'x-frame-options': /DENY/,
    'x-content-type-options': /nosniff/,
    'referrer-policy': /same-origin/,
  };
  if (base.startsWith('https:')) want['strict-transport-security'] = /max-age=\d+/;
  const missing = Object.entries(want).filter(([k, re]) => !re.test(h.get(k) ?? '')).map(([k]) => k);
  if (missing.length) fail('security headers', `missing ${missing.join(', ')}`);
  else ok('security headers', 'no framing, nosniff' + (want['strict-transport-security'] ? ', HSTS' : ''));
}

console.log('Agents');
try {
  const { jobs } = await api('/api/jobs');
  ok('job board', `${jobs.length} open job${jobs.length === 1 ? '' : 's'}`);
} catch (e) {
  fail('job board', e.message);
}
try {
  const res = await fetch(base + '/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const names = ((await res.json()).result?.tools ?? []).map((t) => t.name).sort();
  const want = ['claim_job', 'find_jobs', 'get_job', 'post_job', 'submit_work', 'wait_for_verdict'];
  if (want.every((n) => names.includes(n))) ok('MCP endpoint', names.join(', '));
  else fail('MCP endpoint', `tools: ${names.join(', ') || 'none'}`);
} catch (e) {
  fail('MCP endpoint', e.message);
}

console.log('Demos (replayed reviews, no API cost)');
const expected = { honest: 'released', cheater: 'escalated', partial: 'changes_requested', code: 'changes_requested' };
const runs = await Promise.all(
  Object.keys(expected).map(async (scenario) => {
    try {
      const deal = await api('/api/demo/start', { body: { scenario } });
      await api('/api/demo/deliver', { key: deal.freelancerKey, body: { id: deal.id } });
      const m = await settled(deal.id, deal.clientKey, ['funded', 'submitted', 'reviewing']);
      return { scenario, deal, m };
    } catch (e) {
      return { scenario, error: e.message };
    }
  }),
);
for (const { scenario, deal, m, error } of runs) {
  if (error) fail(scenario, error);
  else if (m.status === expected[scenario]) ok(scenario, m.status);
  else fail(scenario, `ended ${m.status}, expected ${expected[scenario]}`);
  if (scenario === 'honest' && m?.status === 'released') {
    const proof = await fetch(`${base}/m/${deal.id}/proof`);
    if (proof.ok && (await proof.text()).includes('Certificate')) ok('certificate page');
    else fail('certificate page', String(proof.status));
    const record = await api(`/api/escrow/milestones/${deal.id}/record`, { key: deal.clientKey }).catch((e) => ({ error: e.message }));
    if (record.error) fail('deal record download', record.error);
    else ok('deal record download');
    try {
      await api(`/api/escrow/milestones/${deal.id}/complaint`, { key: deal.clientKey, body: { action: 'complain', text: 'Smoke test: one price is wrong', amount: 20 } });
      const { milestone } = await api(`/api/escrow/milestones/${deal.id}/complaint`, { key: deal.freelancerKey, body: { action: 'refund', amount: 15 } });
      const back = milestone.payment.refunds?.at(-1);
      if (milestone.complaint?.status === 'refunded' && back?.amount === '15.00') ok('honest: refund after a complaint', `${back.amount} of ${m.amount} ${m.currency}`);
      else fail('honest: refund after a complaint', `complaint ${milestone.complaint?.status}`);
    } catch (e) {
      fail('honest: refund after a complaint', e.message);
    }
  }
  if (scenario === 'partial' && m?.status === 'changes_requested') {
    try {
      const amount = Number(m.amount) * 0.6;
      await api(`/api/escrow/milestones/${deal.id}/settlement`, { key: deal.freelancerKey, body: { action: 'propose', amount } });
      const { milestone } = await api(`/api/escrow/milestones/${deal.id}/settlement`, { key: deal.clientKey, body: { action: 'accept' } });
      if (milestone.status === 'released') ok('partial: settled for part', `${amount} of ${m.amount} ${m.currency}`);
      else fail('partial: settled for part', `status ${milestone.status}`);
    } catch (e) {
      fail('partial: settled for part', e.message);
    }
  }
}

console.log(`${failed ? `${failed} check(s) failed` : 'All checks passed'} in ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(failed ? 1 : 0);
