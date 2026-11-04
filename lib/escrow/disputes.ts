// When a buyer disputes a payment with PayPal, the deal already holds what PayPal decides on: the
// criteria the buyer wrote, what was delivered and when (each file's SHA-256), what the reviewer and
// the second model found, and the PayPal ids. This turns it into PayPal's evidence: a note (PayPal
// allows 2000 characters) and the whole record as a PDF, plus proof of any refund already made.

import { checkSeal } from './chain.ts';
import { currentReview, latestFindings } from './policy.ts';
import { textPdf, type PdfLine } from './pdf.ts';
import type { Milestone } from './types.ts';

const NOTE_LIMIT = 2000;
const day = (iso?: string) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'unknown');
const pct = (n: number) => `${Math.round(n * 100)}%`;

function facts(m: Milestone) {
  const review = currentReview(m);
  const findings = review ? latestFindings(m.criteria, review.findings) : [];
  const verified = m.timeline.findLast((e) => e.type === 'verified');
  const approved = m.timeline.findLast((e) => e.type === 'approved');
  const settled = m.timeline.findLast((e) => e.type === 'settled');
  const termsChanged = m.timeline.findLast((e) => e.type === 'terms_changed');
  const refunds = (m.payment.refunds ?? []).filter((r) => r.status !== 'FAILED' && r.status !== 'CANCELLED');
  const reviewer = review ? (review.engine === 'claude' ? (review.model ?? 'Claude') : `${review.engine} reviewer`) : undefined;
  const second = review?.audit ? (review.audit.engine === 'claude' ? (review.audit.model ?? 'Claude') : 'simulated second model') : undefined;
  const how = settled
    ? `Settled by agreement of both sides on ${day(settled.at)}: ${settled.text}.`
    : verified && review
      ? `The AI reviewer (${reviewer}) found every criterion met${second ? `, and a second model (${second}) ${review.audit?.agreed ? 'agreed' : 'checked it'}` : ''}; verified ${day(verified.at)}.`
      : approved
        ? `The buyer approved the delivery on ${day(approved.at)}.`
        : undefined;
  return { review, findings, refunds, how, termsChanged, captured: m.payment.capturedAmount ?? m.amount };
}

/** The record's fingerprint, and where PayPal already holds an earlier one. */
function sealLine(m: Milestone): string {
  const seal = checkSeal(m);
  const anchor = m.payment.anchoredRecord;
  return `Record fingerprint (SHA-256 chain over ${seal.events} steps, ${seal.intact ? 'intact' : 'BROKEN'}): ${seal.head}.${anchor ? ` The capture note sent to PayPal carries its fingerprint at payment: ${anchor.slice(0, 16)}.` : ''}`;
}

/** The note PayPal shows with the evidence. */
export function evidenceNote(m: Milestone, origin: string): string {
  const { findings, how, termsChanged, captured } = facts(m);
  const delivery = m.submissions.at(-1);
  const files = delivery?.attachments ?? [];
  const lines = [
    `Service delivered and checked before any money was captured. Proof of Done held the buyer's payment as a PayPal authorization and captured it only once the delivery met the acceptance criteria the buyer wrote.`,
    `Deal "${m.title}" (${m.id}) for ${m.amount} ${m.currency}, created by ${m.client.name} on ${day(m.createdAt)}.${termsChanged ? ` Terms changed with both sides' agreement on ${day(termsChanged.at)}.` : ''}`,
    `Acceptance criteria:`,
    ...m.criteria.map((c, i) => {
      const f = findings[i];
      return `${i + 1}. ${c.text}${f ? ` - ${f.status.replace('_', ' ')} (${pct(f.confidence)})` : ''}`;
    }),
    delivery && `Delivered ${day(delivery.at)}: ${files.length ? `${files.length} file(s) ${files.map((a) => `${a.name}${a.sha256 ? ` sha256 ${a.sha256.slice(0, 16)}` : ''}`).join(', ')}` : 'notes'}${delivery.links.length ? `; links ${delivery.links.join(' ')}` : ''}.`,
    how,
    m.payment.captureId && `PayPal captured ${captured} ${m.currency} on ${day(m.payment.capturedAt)} (capture ${m.payment.captureId}).`,
    sealLine(m),
    `Full record with every step and file hashes is attached; certificate: ${origin}/m/${m.id}/proof`,
  ].filter(Boolean) as string[];
  const note = lines.join('\n');
  return note.length <= NOTE_LIMIT ? note : `${note.slice(0, NOTE_LIMIT - 1)}…`;
}

/** The whole record as a PDF: what PayPal's case reviewer reads. */
export function evidencePdf(m: Milestone, origin: string): Buffer {
  const { review, findings, refunds, how } = facts(m);
  const lines: PdfLine[] = [
    { text: 'Proof of Done - deal record for PayPal', bold: true, size: 16 },
    { text: `${m.title} (${m.id})`, bold: true, size: 12, gap: 6 },
    { text: `${m.amount} ${m.currency}. Paid by ${m.client.name} to ${m.freelancer.name}. Created ${day(m.createdAt)}. Status: ${m.status}.` },
    { text: `Certificate: ${origin}/m/${m.id}/proof` },
    { text: 'What the buyer asked for', bold: true, size: 12, gap: 10 },
    ...(m.description ? [{ text: m.description }] : []),
    ...m.criteria.map((c, i) => {
      const f = findings[i];
      return { text: `${i + 1}. ${c.text}${f ? `\n   Finding: ${f.status.replace('_', ' ')}, ${pct(f.confidence)} confident. ${f.evidence}` : ''}` };
    }),
    { text: 'What was delivered', bold: true, size: 12, gap: 10 },
    ...m.submissions.flatMap((s) => [
      { text: `${day(s.at)}: ${s.notes || '(no notes)'}`, gap: 4 },
      ...s.links.map((l) => ({ text: `   link: ${l}` })),
      ...s.attachments.map((a) => ({ text: `   file: ${a.name} (${a.mime}, ${a.size} bytes)${a.sha256 ? ` SHA-256 ${a.sha256}` : ''}` })),
    ]),
    { text: 'How it was checked', bold: true, size: 12, gap: 10 },
    ...(how ? [{ text: how }] : []),
    ...(review?.summary ? [{ text: `Reviewer: ${review.summary}` }] : []),
    ...(review?.audit ? [{ text: `Second opinion (${review.audit.agreed ? 'agreed' : 'refused'}): ${review.audit.summary}` }] : []),
    { text: 'PayPal', bold: true, size: 12, gap: 10 },
    { text: `Order ${m.payment.orderId ?? '-'}, authorization ${m.payment.authorizationId ?? '-'} (${day(m.payment.authorizedAt)}), capture ${m.payment.captureId ?? '-'} (${day(m.payment.capturedAt)}), payout batch ${m.payment.payoutBatchId ?? '-'}.` },
    ...refunds.map((r) => ({ text: `Refunded ${r.amount} ${m.currency} on ${day(r.at)} (refund ${r.id}).` })),
    { text: 'Every step', bold: true, size: 12, gap: 10 },
    { text: 'Each step carries a SHA-256 of itself and the step before it, so no past step can change unnoticed.', size: 9 },
    ...m.timeline.map((e) => ({ text: `${day(e.at)}  [${e.actor}] ${e.text}\n   sha256 ${e.hash ?? '-'}`, size: 9 })),
    { text: sealLine(m), size: 9, gap: 6 },
  ];
  const head = checkSeal(m).head.slice(0, 16);
  return textPdf(lines, (page, pages) => `Proof of Done record ${m.id} - page ${page} of ${pages} - fingerprint ${head}`);
}

/** What goes to PayPal: proof the service was delivered, and proof of each refund already made. */
export function disputeEvidence(m: Milestone, origin: string) {
  const { refunds } = facts(m);
  const evidences: Record<string, unknown>[] = [{ evidence_type: 'PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED', notes: evidenceNote(m, origin) }];
  if (refunds.length) {
    evidences.push({ evidence_type: 'PROOF_OF_REFUND', evidence_info: { refund_ids: refunds.map((r) => r.id) }, notes: `Refunded through PayPal: ${refunds.map((r) => `${r.amount} ${m.currency}`).join(', ')}.` });
  }
  return { evidences, files: [{ name: `proof-of-done-${m.id}.pdf`, type: 'application/pdf', bytes: evidencePdf(m, origin) }] };
}
