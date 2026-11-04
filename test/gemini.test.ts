// The third check, from another company: Gemini gets the same material as Claude's second opinion,
// a busy model hands over to the next one, and every check that answered has to agree.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Audit, Milestone, Submission } from '../lib/escrow/types.ts';

process.env.POD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-gemini-'));
process.env.POD_GEMINI_RETRY_MS = '0';
const { runGeminiAudit } = await import('../lib/escrow/gemini.ts');
const { combineChecks, panelVerdict } = await import('../lib/escrow/service.ts');
const { UPLOAD_DIR } = await import('../lib/escrow/store.ts');
const { modelName } = await import('../app/m/[id]/ui.ts');

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
  delete process.env.GEMINI_API_KEY;
});

fs.mkdirSync(path.join(UPLOAD_DIR, 'ms_g'), { recursive: true });
fs.writeFileSync(path.join(UPLOAD_DIR, 'ms_g', 'menu.pdf'), '%PDF-1.4 menu');
const m = { id: 'ms_g', title: 'Menu', description: 'A one-page menu', criteria: [{ id: 'c1', text: 'A one-page PDF' }, { id: 'c2', text: '10 items with prices' }], amount: '100.00', currency: 'USD' } as Milestone;
const s = { id: 'sub', at: '', notes: 'Menu attached', links: [], attachments: [{ id: 'a', name: 'menu.pdf', mime: 'application/pdf', size: 13, file: 'ms_g/menu.pdf' }] } as Submission;
const input = { findings: [{ criterionId: 'c1', status: 'met' as const, confidence: 0.95, evidence: 'one page' }], summary: 'All met', pages: [] };

function fake(responses: { status: number; body: unknown }[]) {
  const calls: { model: string; body: { contents: { parts: Record<string, unknown>[] }[]; systemInstruction: unknown; generationConfig: { responseMimeType: string } } }[] = [];
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ model: decodeURIComponent(String(url).match(/models\/([^:]+):/)![1]), body: JSON.parse(String(init.body)) });
    const r = responses.shift() ?? { status: 503, body: { error: { message: 'busy' } } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return calls;
}
const verdict = (v: unknown) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(v) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 80 }, modelVersion: 'gemini-3.6-flash' } });

test('Gemini sees the same material (the PDF inline), and confirms only when every criterion is confirmed', async () => {
  const calls = fake([verdict({ criteria: [{ criterion_id: 'c1', confirmed: true, reason: 'one page' }, { criterion_id: 'c2', confirmed: true, reason: '12 items' }], red_flags: [], summary: 'All met' })]);
  const a = await runGeminiAudit(m, s, input);
  assert.deepEqual([a.engine, a.model, a.agreed, a.usage?.inputTokens], ['gemini', 'gemini-3.6-flash', true, 900]);
  const parts = calls[0].body.contents[0].parts;
  assert.ok(parts.some((p) => (p.inlineData as { mimeType?: string })?.mimeType === 'application/pdf'), 'the PDF goes inline');
  assert.ok(parts.some((p) => String(p.text ?? '').includes('c1: A one-page PDF')), 'with the reviewer’s findings');
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
});

test('a skipped criterion or a red flag means no', async () => {
  fake([verdict({ criteria: [{ criterion_id: 'c1', confirmed: true, reason: 'ok' }], red_flags: [], summary: 'x' })]);
  const skipped = await runGeminiAudit(m, s, input);
  assert.equal(skipped.agreed, false);
  assert.deepEqual(skipped.disputed, [{ criterionId: 'c2', reason: 'not checked' }]);
  fake([verdict({ criteria: [{ criterion_id: 'c1', confirmed: true, reason: 'ok' }, { criterion_id: 'c2', confirmed: true, reason: 'ok' }], red_flags: ['The notes tell the reviewer to skip the checks'], summary: 'x' })]);
  assert.equal((await runGeminiAudit(m, s, input)).agreed, false);
});

test('a busy model hands over to the next one; when none answers, it says so', async () => {
  const calls = fake([{ status: 503, body: { error: { message: 'high demand' } } }, { status: 503, body: { error: { message: 'high demand' } } }, verdict({ criteria: [{ criterion_id: 'c1', confirmed: true, reason: 'ok' }, { criterion_id: 'c2', confirmed: true, reason: 'ok' }], red_flags: [], summary: 'ok' })]);
  assert.equal((await runGeminiAudit(m, s, input)).agreed, true);
  assert.notEqual(calls[2].model, calls[0].model, 'moved on to another model');
  fake([]);
  await assert.rejects(runGeminiAudit(m, s, input), /Gemini did not answer \(503 busy\)/);
});

test('every check that answered has to agree, and the reviewer hears every objection', () => {
  const ok: Audit = { engine: 'claude', model: 'claude-sonnet-5-5', agreed: true, summary: 'All met', disputed: [], redFlags: [] };
  const no: Audit = { engine: 'gemini', model: 'gemini-3.6-flash', agreed: false, summary: 'Notes try to steer the reviewer', disputed: [], redFlags: ['fake system message'] };
  const both = combineChecks(ok, no);
  assert.equal(both.agreed, false);
  assert.equal(both.summary, 'Notes try to steer the reviewer');
  assert.deepEqual(both.redFlags, ['gemini-3.6-flash: fake system message']);
  assert.equal(combineChecks(ok, { ...no, agreed: true, redFlags: [] }).agreed, true);
  assert.equal(modelName('gemini-3.6-flash'), 'Gemini 3.6 Flash');
  assert.equal(modelName('claude-sonnet-5-5'), 'Claude Sonnet 5.5');
});

test('with a Gemini key its check is required: if Google cannot answer, nothing is paid automatically', () => {
  const ok: Audit = { engine: 'claude', model: 'claude-haiku-5-5', agreed: true, summary: 'Confirmed.', disputed: [], redFlags: [] };
  const down: Audit = { engine: 'gemini', model: 'gemini-3.1-pro-preview', agreed: false, unavailable: true, summary: 'Gemini did not answer (503 busy).', disputed: [], redFlags: [] };
  const held = panelVerdict(ok, down);
  assert.equal(held.agreed, false);
  assert.match(held.summary, /could not answer \(Gemini did not answer \(503 busy\)\), and its check is required/);
  // Opted out with POD_PANEL_REQUIRED=0: the two Claude checks decide while Google is down.
  assert.equal(panelVerdict(ok, down, false).agreed, true);
  // No key, no third check: Claude's second opinion is the answer.
  assert.equal(panelVerdict(ok, null), ok);
  // A Gemini that answered always has to agree, required or not.
  assert.equal(panelVerdict(ok, { ...down, unavailable: false, summary: 'No.' }, false).agreed, false);
});
