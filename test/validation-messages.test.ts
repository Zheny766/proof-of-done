// What a person (or an agent) reads when a form is filled in wrong: the field in words and what to
// fix, not zod's paths and "Too small: expected string to have >=3 characters".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.POD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-msg-'));
const { handle } = await import('../lib/escrow/http.ts');
const { CreateMilestoneInput, CreateProjectInput } = await import('../lib/escrow/service.ts');

const errorFor = async (parse: () => unknown) => {
  const route = handle(async (request: Request) => (parse(), new Response(request.url)));
  const res = await route(new Request('http://localhost/', { method: 'GET' }));
  assert.equal(res.status, 400);
  return ((await res.json()) as { error: string }).error;
};

test('validation errors name the field in words and say what to fix', async () => {
  assert.equal(
    await errorFor(() => CreateMilestoneInput.parse({ title: 'ab', criteria: ['x'], amount: '0', clientName: 'A', clientEmail: 'bad' })),
    'The title needs at least 3 characters. Criterion 1 needs at least 3 characters. The amount must be at least 1.',
  );
  assert.equal(
    await errorFor(() => CreateMilestoneInput.parse({ title: 'abc', criteria: [], amount: 'abc', clientName: 'A', clientEmail: 'a@b.co' })),
    'Acceptance criteria: add at least 1. The amount must be a number.',
  );
  assert.equal(
    await errorFor(() => CreateProjectInput.parse({ title: 'abc', clientName: 'A', clientEmail: 'nope', stages: [{ title: 'Draft', amount: 5, criteria: ['ok'] }, { title: 'Final', amount: 5, criteria: ['fine'] }] })),
    'The client email is not a valid email address. Stage 1, criterion 1 needs at least 3 characters.',
  );
});
