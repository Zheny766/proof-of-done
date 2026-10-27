import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Milestone } from '../lib/escrow/types.ts';

// sandboxRuns reads <cwd>/demo/sandbox-runs, fixed when the module loads: run from a throwaway folder.
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-runs-'));
process.chdir(cwd);
const { newAccess } = await import('../lib/escrow/access.ts');
const { publicRun, sandboxRuns } = await import('../lib/escrow/sandbox-runs.ts');

const deal = (over: Partial<Milestone> = {}) =>
  ({
    id: 'ms_real',
    title: 'Menu redesign',
    description: 'Secret brief',
    amount: '250.00',
    currency: 'USD',
    status: 'released',
    createdAt: '2026-10-28T09:00:00.000Z',
    access: newAccess(),
    client: { name: 'Maya', email: 'maya@example.com' },
    freelancer: { name: 'Diego', email: 'diego@example.com' },
    criteria: [{ id: 'c1', text: 'A one-page PDF' }],
    payment: { mode: 'sandbox', orderId: 'O1', authorizationId: 'A1', captureId: 'C1', payoutBatchId: 'B1', payoutStatus: 'SUCCESS', payerEmail: 'buyer@personal.example.com' },
    paypalCalls: [{ at: '2026-10-28T09:01:00.000Z', method: 'POST', path: '/v2/payments/authorizations/A1/capture', status: 201, ms: 900, requestId: 'capture-A1', debugId: 'f00dfeed1' }],
    submissions: [{ id: 's', at: '', notes: 'my work', links: [], attachments: [] }],
    reviews: [
      {
        id: 'r',
        submissionId: 's',
        startedAt: '',
        engine: 'claude',
        model: 'claude-opus-5-5',
        decision: 'release',
        findings: [{ criterionId: 'c1', status: 'met', confidence: 0.96, evidence: 'saw the menu' }],
        log: [{ at: '', kind: 'tool', text: 'read the secret brief' }],
        audit: { engine: 'claude', model: 'claude-haiku-5-5', agreed: true, summary: 'ok', disputed: [], redFlags: [] },
      },
    ],
    board: { postedAt: '', claimedAt: '', claimedBy: 'agent@bots.example.com' },
    timeline: [
      { at: '', actor: 'paypal', type: 'payout', text: 'PayPal paid out to diego@example.com (batch B1)' },
      { at: '', actor: 'agent', type: 'changes', text: 'AI reviewer asked for changes: the menu lists the house secret sauce' },
      { at: '', actor: 'client', type: 'objected', text: 'Client objected: my private reason' },
    ],
    ...over,
  }) as unknown as Milestone;

test('a sandbox run keeps the PayPal ids, debug ids and verdicts, and nothing private', () => {
  const m = deal();
  const run = publicRun(m);
  assert.equal(run.paypal.captureId, 'C1');
  assert.equal(run.paypal.capturedAmount, '250.00');
  assert.equal(run.calls[0].debugId, 'f00dfeed1');
  assert.deepEqual(run.criteria, [{ text: 'A one-page PDF', status: 'met', confidence: 0.96 }]);
  assert.deepEqual(run.review, { reviewer: 'claude-opus-5-5', decision: 'release', secondOpinion: { by: 'claude-haiku-5-5', agreed: true } });
  const json = JSON.stringify(run);
  for (const secret of [m.access!.clientKey, m.access!.freelancerKey, 'Secret brief', 'my work', 'saw the menu', 'read the secret brief', '@example.com', 'capture-A1', 'secret sauce', 'private reason'])
    assert.ok(!json.includes(secret), `leaked: ${secret}`);
  assert.match(run.timeline[0].text, /paid out to \[email\]/);
  assert.deepEqual(run.timeline.slice(1).map((e) => e.text), ['AI reviewer asked for changes', 'Client objected']);
  assert.equal(run.takenBy, '[email]');
});

test('only deals that ran on the PayPal sandbox can be exported', () => {
  assert.throws(() => publicRun(deal({ payment: { mode: 'simulated', authorizationId: 'AUTH-DEMO-1' } })), /did not run on the PayPal sandbox/);
  assert.throws(() => publicRun(deal({ payment: { mode: 'sandbox' } })), /did not run on the PayPal sandbox/);
});

test('saved runs are read oldest first; no folder means no runs', () => {
  assert.deepEqual(sandboxRuns(), []);
  const dir = path.join(cwd, 'demo', 'sandbox-runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(publicRun(deal({ id: 'b', createdAt: '2026-10-29T00:00:00.000Z' }))));
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(publicRun(deal({ id: 'a' }))));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
  assert.deepEqual(sandboxRuns().map((r) => r.id), ['a', 'b']);
});
