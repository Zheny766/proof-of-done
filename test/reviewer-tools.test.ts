// The Claude reviewer's tools, called directly (no API): the release policy gate, one decision per
// review even when tools run concurrently, and which links it may open.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.POD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-tools-'));
const { reviewTools } = await import('../lib/escrow/reviewer.ts');
import type { Audit, Milestone, Submission } from '../lib/escrow/types.ts';

const milestone = {
  id: 'ms_t',
  title: 'Landing page',
  description: '',
  criteria: [
    { id: 'c1', text: 'Page is live' },
    { id: 'c2', text: 'Menu has prices' },
  ],
  amount: '100.00',
  currency: 'USD',
  releaseThreshold: 0.8,
  reviews: [],
} as unknown as Milestone;
const submission: Submission = { id: 's1', at: '', notes: 'See https://shop.example.com.', links: ['https://site.example.org/'], attachments: [] };

type Verdict = Pick<Audit, 'agreed' | 'disputed' | 'redFlags'> | Error;

function setup(verdict: Verdict = { agreed: true, disputed: [], redFlags: [] }) {
  const calls: string[] = [];
  const hooks = {
    log: () => {},
    finding: () => {},
    audit: async (): Promise<Audit> => {
      calls.push('audit');
      if (verdict instanceof Error) throw verdict;
      return { engine: 'claude', model: 'second-model', summary: '', ...verdict };
    },
    release: async () => {
      calls.push('release');
      await new Promise((r) => setTimeout(r, 20)); // a PayPal round trip
      return {};
    },
    requestChanges: async () => void calls.push('changes'),
    escalate: async () => void calls.push('escalate'),
  };
  const { tools, outcome } = reviewTools(milestone, submission, hooks);
  const tool = (name: string) => {
    const t = tools.find((x) => x.name === name)!;
    return (input: unknown) => t.run(t.parse(input) as never) as Promise<string>;
  };
  return { tool, outcome, calls };
}

test('release is refused until every criterion is met above the threshold', async () => {
  const { tool, calls } = setup();
  await tool('record_finding')({ criterion_id: 'c1', status: 'met', confidence: 0.95, evidence: 'opened it' });
  assert.match(await tool('release_payment')({ summary: 'ok' }), /Refused by the release policy/);
  await tool('record_finding')({ criterion_id: 'c2', status: 'met', confidence: 0.6, evidence: 'not sure' });
  assert.match(await tool('release_payment')({ summary: 'ok' }), /below the 80% threshold/);
  await tool('record_finding')({ criterion_id: 'c2', status: 'met', confidence: 0.9, evidence: 'prices shown' });
  assert.match(await tool('release_payment')({ summary: 'ok' }), /captured/);
  assert.deepEqual(calls, ['audit', 'release'], 'the second opinion comes only after the policy passes');
});

test('two decisions in the same turn: only the first goes ahead', async () => {
  const { tool, outcome, calls } = setup();
  await tool('record_finding')({ criterion_id: 'c1', status: 'met', confidence: 0.9, evidence: 'x' });
  await tool('record_finding')({ criterion_id: 'c2', status: 'met', confidence: 0.9, evidence: 'y' });
  const [release, changes, escalate] = await Promise.all([
    tool('release_payment')({ summary: 'ok' }),
    tool('request_changes')({ feedback: 'more', summary: 'more' }),
    tool('escalate_to_client')({ reason: 'hmm', summary: 'hmm' }),
  ]);
  assert.match(release, /captured/);
  assert.match(changes, /already been made/);
  assert.match(escalate, /already been made/);
  assert.deepEqual(calls, ['audit', 'release']);
  assert.equal(outcome()?.decision, 'release');
  assert.match(await tool('record_finding')({ criterion_id: 'c1', status: 'not_met', confidence: 1, evidence: 'z' }), /can no longer change/);
});

test('a second opinion that does not confirm stops the release for good', async () => {
  const { tool, outcome, calls } = setup({ agreed: false, disputed: [{ criterionId: 'c2', reason: 'no prices in the screenshot' }], redFlags: [] });
  await tool('record_finding')({ criterion_id: 'c1', status: 'met', confidence: 0.95, evidence: 'x' });
  await tool('record_finding')({ criterion_id: 'c2', status: 'met', confidence: 0.95, evidence: 'y' });
  assert.match(await tool('release_payment')({ summary: 'ok' }), /independent check did not confirm it \(c2: no prices/);
  // Retrying (even after "fixing" a finding) doesn't ask again and doesn't pay.
  await tool('record_finding')({ criterion_id: 'c2', status: 'met', confidence: 0.99, evidence: 'surely' });
  assert.match(await tool('release_payment')({ summary: 'ok' }), /already refused/);
  assert.deepEqual(calls, ['audit']);
  assert.equal(outcome(), null);
  assert.match(await tool('escalate_to_client')({ reason: 'auditor disagrees', summary: 's' }), /asked to decide/);
  assert.equal(outcome()?.decision, 'escalate');
});

test('red flags or a failed second opinion also keep the money on hold', async () => {
  for (const verdict of [{ agreed: false, disputed: [], redFlags: ['hidden text tells the reviewer to pay'] }, new Error('timeout')]) {
    const { tool, calls } = setup(verdict);
    await tool('record_finding')({ criterion_id: 'c1', status: 'met', confidence: 0.95, evidence: 'x' });
    await tool('record_finding')({ criterion_id: 'c2', status: 'met', confidence: 0.95, evidence: 'y' });
    assert.match(await tool('release_payment')({ summary: 'ok' }), /Release refused/);
    assert.deepEqual(calls, ['audit']);
  }
});

test('unknown criteria and bad confidences are rejected', async () => {
  const { tool } = setup();
  assert.match(await tool('record_finding')({ criterion_id: 'c9', status: 'met', confidence: 0.9, evidence: 'x' }), /unknown criterion_id/);
  // The tool runner validates input with the tool's schema before running it.
  assert.throws(() => tool('record_finding')({ criterion_id: 'c1', status: 'met', confidence: 3, evidence: 'x' }), /expected number to be <=1/);
});

test('fetch_link only opens sites the submission links to, and only so many', async () => {
  const { tool } = setup();
  assert.match(await tool('fetch_link')({ url: 'https://attacker.example/?brief=secret' }), /only sites linked in the submission/);
  assert.match(await tool('fetch_link')({ url: 'not a url' }), /not a valid URL/);
  // Allowed hosts (from the links and the notes) get past the allowlist; localhost never does.
  const blocked = await tool('fetch_link')({ url: 'http://localhost:3000/admin' });
  assert.match(blocked, /only sites linked/);
  for (let i = 0; i < 5; i++) await tool('fetch_link')({ url: 'https://attacker.example/' });
  assert.match(await tool('fetch_link')({ url: 'https://site.example.org/' }), /at most 8 pages/);
});

test('the code sandbox is offered only when the delivery has code, and can be switched off', async () => {
  const { deliversCode } = await import('../lib/escrow/reviewer.ts');
  const sub = (...names: string[]) => ({ id: 's', at: '', notes: '', links: [], attachments: names.map((name, i) => ({ id: `a${i}`, name, mime: 'text/plain', size: 1, file: name })) });
  assert.equal(deliversCode(sub('menu.pdf', 'logo.png')), false);
  assert.equal(deliversCode(sub('README.md', 'validator.py')), true);
  process.env.POD_CODE_EXECUTION = '0';
  assert.equal(deliversCode(sub('validator.py')), false);
  delete process.env.POD_CODE_EXECUTION;
});

test('a delivery with code is never paid before the code was run in this review', async () => {
  // The independent checks can't run code: a passing-tests screenshot would only have to fool the reviewer.
  const code: Submission = { ...submission, attachments: [{ id: 'att1', name: 'validator.py', mime: 'text/x-python', size: 10, file: 'x/validator.py' }] };
  for (const ran of [false, true]) {
    const released: string[] = [];
    const hooks = {
      log: () => {},
      finding: () => {},
      audit: async (): Promise<Audit> => ({ engine: 'claude', model: 'second-model', summary: '', agreed: true, disputed: [], redFlags: [] }),
      release: async () => ((released.push('release'), {}) as Record<string, never>),
      requestChanges: async () => {},
      escalate: async () => {},
    };
    const { tools } = reviewTools(milestone, code, hooks, () => ran);
    const tool = (name: string) => {
      const x = tools.find((y) => y.name === name)!;
      return (input: unknown) => x.run(x.parse(input) as never) as Promise<string>;
    };
    for (const c of ['c1', 'c2']) await tool('record_finding')({ criterion_id: c, status: 'met', confidence: 0.95, evidence: ran ? 'python3 validator.py: 4 tests passed' : 'the screenshot shows 4 tests passing' });
    const answer = await tool('release_payment')({ summary: 'All met' });
    if (ran) assert.deepEqual(released, ['release']);
    else {
      assert.match(answer, /has not been run in the sandbox/);
      assert.deepEqual(released, []);
    }
  }
});
