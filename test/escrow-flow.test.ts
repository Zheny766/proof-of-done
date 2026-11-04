// The escrow state machine end to end, in simulated mode (no PayPal or Anthropic keys), against a
// throwaway data directory. Run with --conditions=react-server so `server-only` resolves.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-test-'));
process.env.POD_DATA_DIR = dataDir;
process.env.POD_SIM_STEP_MS = '0';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) delete process.env[key];

const service = await import('../lib/escrow/service.ts');
const store = await import('../lib/escrow/store.ts');
const payments = await import('../lib/escrow/payments.ts');

before(() => store.deleteAll());
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const input = (over: Record<string, unknown> = {}) => ({
  title: 'Landing page for a bakery',
  criteria: ['The page is live at a public URL', 'A menu lists at least 6 items with prices'],
  amount: 120,
  clientName: 'Maya',
  clientEmail: 'maya@example.com',
  freelancerName: 'Diego',
  freelancerEmail: 'diego@example.com',
  releaseThreshold: 0.7,
  ...over,
});

async function funded(over: Record<string, unknown> = {}) {
  const m = service.createMilestone(input(over));
  const { clientKey, freelancerKey } = m.access!;
  const { orderId } = await service.beginFunding(m.id, clientKey);
  await service.confirmFunding(m.id, orderId, clientKey);
  return { id: m.id, clientKey, freelancerKey };
}

// Deliveries carry a link: notes alone never pass the simulated check (see runSimulatedAudit).
async function submitAndReview(id: string, freelancerKey: string, notes: string) {
  const { reviewId } = await service.submitWork(id, { notes, links: ['https://bakery.example/'], files: [] }, freelancerKey);
  await service.runReview(id, reviewId);
  return store.getMilestone(id)!;
}

const count = (id: string, type: string) => store.getMilestone(id)!.timeline.filter((e) => e.type === type).length;

test('happy path: fund, submit, AI verifies, PayPal captures and pays out', async () => {
  const { id, freelancerKey } = await funded();
  assert.equal(store.getMilestone(id)!.status, 'funded');
  const m = await submitAndReview(id, freelancerKey, 'The page is live at a public URL: https://bakery.example. The menu lists croissant, baguette, sourdough, brioche, eclair and tart, with prices from $2 to $6.');
  assert.equal(m.status, 'released');
  assert.match(m.payment.captureId ?? '', /^CAPTURE-SIM-/);
  assert.equal(m.payment.payoutStatus, 'SUCCESS');
  for (const type of ['authorized', 'submitted', 'verified', 'captured', 'payout']) assert.equal(count(id, type), 1, type);
});

test('each party can only do its own part', async () => {
  const m = service.createMilestone(input());
  const { clientKey, freelancerKey } = m.access!;
  await assert.rejects(service.beginFunding(m.id, freelancerKey), /Only the client/);
  await assert.rejects(service.beginFunding(m.id, null), /Only the client/);
  const { orderId } = await service.beginFunding(m.id, clientKey);
  await assert.rejects(service.confirmFunding(m.id, orderId, freelancerKey), /Only the client/);
  await assert.rejects(service.confirmFunding(m.id, 'ORDER-SIM-SOMEONE-ELSES', clientKey), /not for this deal/);
  await service.confirmFunding(m.id, orderId, clientKey);
  await assert.rejects(service.submitWork(m.id, { notes: 'x', links: [], files: [] }, clientKey), /Only the freelancer/);
  await assert.rejects(service.clientDecision(m.id, 'approve', '', freelancerKey), /Only the client/);
  await assert.rejects(service.clientDecision(m.id, 'cancel', '', 'wrong-key'), /Only the client/);
});

test('weak evidence escalates; the client can ask for changes, the freelancer resubmits', async () => {
  const { id, clientKey, freelancerKey } = await funded({ releaseThreshold: 0.99 });
  await assert.rejects(service.clientDecision(id, 'request_changes', 'more', clientKey), /once the AI has reviewed a delivery; the deal is funded/);
  let m = await submitAndReview(id, freelancerKey, 'The page is live at a public URL: https://bakery.example. The menu lists croissant, baguette, sourdough, brioche, eclair and tart, with prices from $2 to $6.');
  assert.equal(m.status, 'escalated', 'confidence never reaches 99%');
  m = await service.clientDecision(id, 'request_changes', 'Add the prices', clientKey);
  assert.equal(m.status, 'changes_requested');
  assert.equal(m.reviews.at(-1)!.feedback, 'Add the prices');
  await service.submitWork(id, { notes: 'Prices added', links: [], files: [] }, freelancerKey);
  assert.equal(store.getMilestone(id)!.status, 'reviewing');
});

test('missing work gets "changes requested" and the money stays on hold', async () => {
  const { id, freelancerKey } = await funded();
  const m = await submitAndReview(id, freelancerKey, 'Hello');
  assert.equal(m.status, 'changes_requested');
  assert.equal(m.payment.captureId, undefined);
});

test('the client can approve after an escalation, and the banner data says so', async () => {
  const { id, clientKey, freelancerKey } = await funded({ releaseThreshold: 0.99 });
  await submitAndReview(id, freelancerKey, 'The page is live at a public URL: https://bakery.example. The menu lists croissant, baguette, sourdough, brioche, eclair and tart, with prices from $2 to $6.');
  const m = await service.clientDecision(id, 'approve', 'Looks good', clientKey);
  assert.equal(m.status, 'released');
  assert.equal(count(id, 'approved'), 1);
  assert.equal(count(id, 'verified'), 0, 'not marked as verified by the AI');
});

test('cancel: before funding nothing to void, after funding the hold is voided', async () => {
  const unfunded = service.createMilestone(input());
  let m = await service.clientDecision(unfunded.id, 'cancel', '', unfunded.access!.clientKey);
  assert.equal(m.status, 'cancelled');
  assert.match(m.timeline.at(-1)!.text, /before funding/);

  const { id, clientKey } = await funded();
  m = await service.clientDecision(id, 'cancel', '', clientKey);
  assert.equal(m.status, 'cancelled');
  assert.equal(m.payment.authorizationStatus, 'VOIDED');
  await assert.rejects(service.clientDecision(id, 'approve', '', clientKey), /nothing to pay now: the deal is cancelled/);
});

test('a submission waits for a cancel in flight instead of racing it', async () => {
  const { id, clientKey, freelancerKey } = await funded();
  const [cancel, submit] = await Promise.allSettled([
    service.clientDecision(id, 'cancel', '', clientKey),
    service.submitWork(id, { notes: 'x', links: [], files: [] }, freelancerKey),
  ]);
  assert.equal(cancel.status, 'fulfilled');
  assert.equal(submit.status, 'rejected');
  assert.equal(store.getMilestone(id)!.status, 'cancelled');
  assert.equal(store.getMilestone(id)!.submissions.length, 0);
});

test('five approvals at once: one capture, four refusals', async () => {
  const { id, clientKey } = await funded();
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => service.clientDecision(id, 'approve', '', clientKey)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(count(id, 'captured'), 1);
  assert.equal(count(id, 'approved'), 1);
});

test('a review that never finished is handed to the client', async () => {
  const { id, freelancerKey } = await funded();
  const { reviewId } = await service.submitWork(id, { notes: 'x', links: [], files: [] }, freelancerKey);
  store.updateMilestone(id, (x) => {
    x.reviews.find((r) => r.id === reviewId)!.startedAt = new Date(Date.now() - 60 * 60_000).toISOString();
  });
  const m = await service.readMilestone(id);
  assert.equal(m!.status, 'escalated');
  assert.equal(count(id, 'review_failed'), 1);
});

test('the freelancer sets where the payout goes; bad addresses are refused', async () => {
  const { id, freelancerKey } = await funded();
  await assert.rejects(service.submitWork(id, { notes: 'x', links: [], files: [], payoutEmail: 'nope' }, freelancerKey), /valid PayPal email/);
  const { milestone } = await service.submitWork(id, { notes: 'x', links: [], files: [], payoutEmail: 'diego.pay@example.com' }, freelancerKey);
  assert.equal(milestone.freelancer.email, 'diego.pay@example.com');
  assert.equal(count(id, 'payout_email'), 1);
});

test('uploads are stored with the type from their bytes', async () => {
  const { id, freelancerKey } = await funded();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const { milestone } = await service.submitWork(
    id,
    { notes: 'x', links: [], files: [{ name: 'shot.txt', type: 'text/plain', bytes: png }, { name: 'fake.png', type: 'image/png', bytes: Buffer.from('text') }] },
    freelancerKey,
  );
  assert.deepEqual(milestone.submissions.at(-1)!.attachments.map((a) => a.mime), ['image/png', 'application/octet-stream']);
  // Each file's SHA-256 goes on the proof certificate, so anyone holding the file can check it.
  const sha = (await import('node:crypto')).createHash('sha256').update(png).digest('hex');
  assert.equal(milestone.submissions.at(-1)!.attachments[0].sha256, sha);
});

test('only USD, positive amounts, at least one criterion', () => {
  assert.throws(() => service.createMilestone(input({ currency: 'EUR' })));
  assert.throws(() => service.createMilestone(input({ amount: -5 })));
  assert.throws(() => service.createMilestone(input({ amount: 0.001 })), 'would round to 0.00');
  assert.throws(() => service.createMilestone(input({ criteria: [] })));
});

test('a simulated order is refused once real PayPal keys are configured', async () => {
  process.env.PAYPAL_CLIENT_ID = 'x';
  process.env.PAYPAL_SECRET = 'y';
  try {
    await assert.rejects(payments.completeFunding('ORDER-SIM-ABC'), /Simulated orders are not accepted/);
  } finally {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_SECRET;
  }
});

test('a corrupt data file is an error, never an empty store', () => {
  const file = path.join(dataDir, 'milestones.json');
  const good = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, '{ not json');
  try {
    assert.throws(() => store.listMilestones(), /not valid JSON/);
    assert.throws(() => service.createMilestone(input()), /not valid JSON/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ not json', 'nothing was overwritten');
  } finally {
    fs.writeFileSync(file, good);
  }
});

test('demo data never happens in the future and keeps holds inside the 29-day window', async () => {
  const { seedDemo } = await import('../lib/escrow/demo.ts');
  store.deleteAll();
  seedDemo(30);
  const now = Date.now();
  for (const m of store.listMilestones()) {
    const times = [m.createdAt, m.updatedAt, m.payment.authorizedAt, m.payment.capturedAt, m.payment.voidedAt, ...m.timeline.map((e) => e.at)];
    for (const t of times) if (t) assert.ok(Date.parse(t) <= now, `${m.title}: ${t} is in the future`);
    if (['funded', 'changes_requested', 'escalated'].includes(m.status)) {
      assert.ok(Date.parse(m.payment.expiresAt!) > now, `${m.title}: the hold would have expired`);
    }
  }
  store.deleteAll();
});

const goodNotes = 'The page is live at a public URL: https://bakery.example. The menu lists croissant, baguette, sourdough, brioche, eclair and tart, with prices from $2 to $6.';

test('objection window: verified work waits, the client can object or pay now', async () => {
  let { id, clientKey, freelancerKey } = await funded({ objectionHours: 24 });
  let m = await submitAndReview(id, freelancerKey, goodNotes);
  assert.equal(m.status, 'verified');
  assert.equal(m.payment.captureId, undefined, 'nothing captured yet');
  assert.ok(Date.parse(m.releaseAt!) > Date.now() + 23 * 3_600_000);
  assert.equal((await service.readMilestone(id))!.status, 'verified', 'not due yet');
  await assert.rejects(service.clientDecision(id, 'approve', '', freelancerKey), /Only the client/);
  m = await service.clientDecision(id, 'request_changes', 'The menu PDF is missing', clientKey);
  assert.equal(m.status, 'changes_requested');
  assert.equal(m.releaseAt, undefined);
  assert.match(m.timeline.at(-1)!.text, /objected/);

  ({ id, clientKey, freelancerKey } = await funded({ objectionHours: 24 }));
  await submitAndReview(id, freelancerKey, goodNotes);
  m = await service.clientDecision(id, 'approve', '', clientKey);
  assert.equal(m.status, 'released');
  assert.equal(m.releaseAt, undefined);
});

test('objection window: with no objection the money moves once, when the window closes', async () => {
  const { id, freelancerKey } = await funded({ objectionHours: 1 });
  await submitAndReview(id, freelancerKey, goodNotes);
  store.updateMilestone(id, (x) => {
    x.releaseAt = new Date(Date.now() - 1000).toISOString();
  });
  const [a, b] = await Promise.all([service.readMilestone(id), service.readMilestone(id)]);
  assert.equal(a!.status, 'released');
  assert.equal(b!.status, 'released');
  assert.equal(count(id, 'captured'), 1, 'two readers, one capture');
  assert.equal(count(id, 'window_closed'), 1);
  assert.equal(count(id, 'verified'), 1);
});

test('settling for part: one side offers, only the other accepts, PayPal captures just that', async () => {
  const { id, clientKey, freelancerKey } = await funded({ releaseThreshold: 0.99 });
  await assert.rejects(service.settle(id, { action: 'propose', amount: 50 }, freelancerKey), /settle once a review.*the deal is funded/);
  await submitAndReview(id, freelancerKey, goodNotes);
  assert.equal(store.getMilestone(id)!.status, 'escalated');
  await assert.rejects(service.settle(id, { action: 'propose', amount: 120 }, freelancerKey), /less than/);
  await assert.rejects(service.settle(id, { action: 'propose', amount: 50 }, null), /Only the client or the freelancer/);
  await assert.rejects(service.settle(id, { action: 'accept' }, clientKey), /no open offer/);

  let m = await service.settle(id, { action: 'propose', amount: 80, note: 'Menu done, no booking form' }, freelancerKey);
  assert.equal(m.settlement?.by, 'freelancer');
  assert.equal(m.settlement?.amount, '80.00');
  const { viewerMilestone } = await import('../lib/escrow/access.ts');
  assert.equal(viewerMilestone(m).settlement, undefined, 'outsiders do not see offers');
  await assert.rejects(service.settle(id, { action: 'accept' }, freelancerKey), /other party/);
  m = await service.settle(id, { action: 'decline' }, clientKey);
  assert.equal(m.settlement, undefined);

  await service.settle(id, { action: 'propose', amount: 70 }, clientKey);
  m = await service.settle(id, { action: 'accept' }, freelancerKey);
  assert.equal(m.status, 'released');
  assert.equal(m.payment.capturedAmount, '70.00');
  assert.equal(count(id, 'settled'), 1);
  assert.match(m.timeline.find((e) => e.type === 'captured')!.text, /other 50\.00 USD of the hold went back/);
  await assert.rejects(service.settle(id, { action: 'propose', amount: 10 }, clientKey), /settle once a review.*the deal is paid/);
});

test('a new submission withdraws an open offer', async () => {
  const { id, freelancerKey } = await funded();
  await submitAndReview(id, freelancerKey, 'Hello');
  assert.equal(store.getMilestone(id)!.status, 'changes_requested');
  await service.settle(id, { action: 'propose', amount: 60 }, freelancerKey);
  await service.submitWork(id, { notes: 'Fixed everything', links: [], files: [] }, freelancerKey);
  assert.equal(store.getMilestone(id)!.settlement, undefined);
});

test('demo deals: funded with a simulated hold, and the prepared delivery replays a recorded review', async () => {
  const outcomes: Record<string, string> = {};
  for (const scenario of ['honest', 'cheater', 'partial', 'code', 'logo']) {
    const m = service.startDemo(scenario);
    assert.equal(m.status, 'funded');
    assert.equal(m.payment.mode, 'simulated');
    assert.deepEqual(m.demo, { scenario });
    await assert.rejects(service.deliverDemo(m.id, m.access!.clientKey), /Only the freelancer/);
    const { reviewId } = await service.deliverDemo(m.id, m.access!.freelancerKey);
    await service.runReview(m.id, reviewId);
    const after = store.getMilestone(m.id)!;
    const review = after.reviews.at(-1)!;
    assert.equal(review.engine, 'replay');
    assert.equal(review.findings.length, scenario === 'code' || scenario === 'logo' ? 4 : 3);
    outcomes[scenario] = after.status;
    if (scenario === 'code') assert.ok(review.log.some((l) => /Anthropic's sandbox/.test(l.text)), 'the replay shows the code being run');
    if (scenario === 'cheater') assert.equal(review.audit?.agreed, false, 'the second opinion refused');
    if (scenario === 'logo') {
      // The taste criterion is the client's: the facts pass, and the payment waits for the objection window.
      assert.equal(after.criteria.at(-1)?.judge, 'client');
      assert.equal(after.payment.captureId, undefined);
      assert.ok(after.releaseAt);
    }
  }
  assert.deepEqual(outcomes, { honest: 'released', cheater: 'escalated', partial: 'changes_requested', code: 'changes_requested', logo: 'verified' });
  const normal = service.createMilestone(input());
  assert.throws(() => service.deliverDemo(normal.id, normal.access!.freelancerKey), /not a demo deal/);
  assert.throws(() => service.startDemo('../../etc'), /Unknown demo scenario/);
});

test('a job that outlasts the 3-day honor period gets its hold renewed once, on the record', async () => {
  const { id } = await funded();
  store.updateMilestone(id, (x) => void (x.payment.honorExpiresAt = new Date(Date.now() - 3_600_000).toISOString()));
  const before = store.getMilestone(id)!.payment.authorizationId;
  const m = (await service.readMilestone(id))!;
  assert.notEqual(m.payment.authorizationId, before);
  assert.equal(m.payment.previousAuthorizationId, before);
  assert.ok(Date.parse(m.payment.honorExpiresAt!) > Date.now());
  await service.readMilestone(id);
  assert.equal(count(id, 'reauthorized'), 1);
});

test('the deal record for a dispute: evidence, every step, the PayPal ids and the certificate', async () => {
  const { id, freelancerKey } = await funded();
  await submitAndReview(id, freelancerKey, 'The page is live at a public URL: https://bakery.example. The menu lists croissant, baguette, sourdough, brioche, eclair and tart, with prices from $2 to $6.');
  const { dealRecord } = await import('../lib/escrow/record.ts');
  const record = dealRecord(store.getMilestone(id)!, 'client', 'https://pod.example');
  assert.equal(record.requestedBy, 'client');
  assert.equal(record.criteria.length, 2);
  assert.ok(record.criteria.every((c) => c.finding));
  assert.match(record.paypal.captureId ?? '', /^CAPTURE-SIM-/);
  assert.ok(record.reviews[0].steps.length > 0);
  assert.equal(record.certificate, `https://pod.example/m/${id}/proof`);
  assert.ok(!JSON.stringify(record).includes('clientKey'), 'no access keys');
});

test('demo deals are throwaways: gone after two days', () => {
  const old = service.startDemo('honest');
  store.updateMilestone(old.id, (x) => void (x.createdAt = new Date(Date.now() - 3 * 86_400_000).toISOString()));
  const fresh = service.startDemo('honest');
  assert.equal(store.getMilestone(old.id), undefined);
  assert.ok(store.getMilestone(fresh.id));
});

test('the demo history is recognised once loaded, so the button that loads it can stay away', async () => {
  const { hasDemoHistory, seedDemo } = await import('../lib/escrow/demo.ts');
  store.deleteAll();
  assert.equal(hasDemoHistory(), false);
  seedDemo(5);
  assert.equal(hasDemoHistory(), true);
});

test('the demo history tells each deal in the order it could have happened', async () => {
  const { seedDemo } = await import('../lib/escrow/demo.ts');
  store.deleteAll();
  seedDemo(30);
  for (const m of store.listMilestones()) {
    for (let i = 1; i < m.timeline.length; i++) assert.ok(m.timeline[i].at >= m.timeline[i - 1].at, `${m.title}: "${m.timeline[i].text}" comes before "${m.timeline[i - 1].text}"`);
    const types = m.timeline.map((e) => e.type);
    if (types.includes('claimed')) assert.ok(types.indexOf('authorized') < types.indexOf('claimed'), `${m.title}: taken from the board before it was funded`);
  }
});

test('sync with PayPal renews a hold past its guarantee and says what changed, and is a no-op otherwise', async () => {
  store.deleteAll();
  const { id } = await funded();
  assert.deepEqual((await service.syncWithPayPal(id)).changes, ['Nothing to do: the deal already matches PayPal']);
  const before = store.getMilestone(id)!.payment.authorizationId;
  store.updateMilestone(id, (x) => void (x.payment.honorExpiresAt = new Date(Date.now() - 1000).toISOString()));
  const { changes } = await service.syncWithPayPal(id);
  assert.match(changes[0], /PayPal renewed the hold/);
  assert.notEqual(store.getMilestone(id)!.payment.authorizationId, before);
});

test('a deadline starts when PayPal holds the money; once it passes the client is told, once', async () => {
  store.deleteAll();
  const { id } = await funded({ dueDays: 7 });
  const m = store.getMilestone(id)!;
  assert.ok(Math.abs(Date.parse(m.dueAt!) - (Date.parse(m.payment.authorizedAt!) + 7 * 86_400_000)) < 5_000);
  store.updateMilestone(id, (x) => void (x.dueAt = new Date(Date.now() - 1000).toISOString()));
  await service.readMilestone(id);
  await service.readMilestone(id);
  assert.equal(store.getMilestone(id)!.timeline.filter((e) => e.type === 'overdue').length, 1);
});

test('a project stage takes its planned days as its deadline; a board job has its claim window instead', () => {
  const [stage] = service.createProject({ ...input(), stages: [{ title: 'Draft', amount: 10, days: 4, criteria: ['A PDF draft'] }, { title: 'Final', amount: 10, days: 6, criteria: ['A PDF final'] }] });
  assert.equal(stage.dueDays, 4);
  assert.equal(service.createMilestone({ ...input(), postToBoard: true, dueDays: 5 }).dueDays, undefined);
});

test('a deal takes at most 12 deliveries, and the server a day’s worth of files', async () => {
  store.deleteAll();
  const { id, freelancerKey } = await funded();
  for (let i = 0; i < 12; i++) {
    store.updateMilestone(id, (x) => void (x.status = 'changes_requested'));
    await service.submitWork(id, { notes: `try ${i}`, links: [], files: [] }, freelancerKey);
  }
  store.updateMilestone(id, (x) => void (x.status = 'changes_requested'));
  await assert.rejects(service.submitWork(id, { notes: 'one more', links: [], files: [] }, freelancerKey), /has had 12 deliveries/);

  process.env.POD_UPLOAD_DAILY_MB = '1';
  try {
    const other = await funded();
    const big = { name: 'big.pdf', type: 'application/pdf', bytes: Buffer.alloc(1024 * 1024 + 1) };
    await assert.rejects(service.submitWork(other.id, { notes: 'here', links: [], files: [big] }, other.freelancerKey), /taken all the files it accepts today/);
    // Links and notes still go through.
    assert.equal((await service.submitWork(other.id, { notes: 'https://example.com/menu', links: ['https://example.com/menu'], files: [] }, other.freelancerKey)).milestone.status, 'reviewing');
  } finally {
    delete process.env.POD_UPLOAD_DAILY_MB;
  }
});

test('the simulated check never pays for notes that just repeat the criteria, or with real PayPal money', async () => {
  store.deleteAll();
  // The trick: the criteria copied back as "notes", nothing else.
  const a = await funded();
  const { reviewId } = await service.submitWork(a.id, { notes: 'The page is live at a public URL. A menu lists at least 6 items with prices.', links: [], files: [] }, a.freelancerKey);
  await service.runReview(a.id, reviewId);
  const held = store.getMilestone(a.id)!;
  assert.equal(held.status, 'escalated');
  assert.equal(held.payment.captureId, undefined);
  assert.match(held.reviews[0].audit!.summary, /Only notes were delivered/);

  // On a deal with real PayPal sandbox money only a live AI review releases it.
  const b = await funded();
  store.updateMilestone(b.id, (x) => void (x.payment.mode = 'sandbox'));
  const m = await submitAndReview(b.id, b.freelancerKey, goodNotes);
  assert.equal(m.status, 'escalated');
  assert.match(m.reviews[0].audit!.summary, /only after a live AI review/);
});

test('without a live AI review nothing is paid automatically, however good the delivery looks', async () => {
  store.deleteAll();
  delete process.env.POD_SIM_CAN_RELEASE;
  try {
    const { id, freelancerKey } = await funded();
    const m = await submitAndReview(id, freelancerKey, goodNotes);
    assert.equal(m.status, 'escalated', 'the client decides');
    assert.equal(m.payment.captureId, undefined);
    assert.match(m.reviews[0].audit!.summary, /Without a live AI review nothing is paid automatically/);
  } finally {
    process.env.POD_SIM_CAN_RELEASE = '1';
  }
});
