import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { checkSeal } from '@/lib/escrow/chain';
import { currentReview, latestFindings } from '@/lib/escrow/policy';
import { readMilestone } from '@/lib/escrow/service';
import { SiteHeader } from '@/app/components/site-header';
import { fmtDay, fmtMoney, fmtTime } from '@/app/components/status';
import { modelName } from '../ui';
import { CheckFile } from './check-file';
import { SealNote } from '../details';

export async function generateMetadata(props: PageProps<'/m/[id]/proof'>): Promise<Metadata> {
  const { id } = await props.params;
  const m = await readMilestone(id);
  return { title: m ? `Proof of Done: ${m.title}` : 'Proof of Done' };
}

// A certificate for paid work, safe to share: what was asked, what the AI found for each criterion,
// how the money moved, and a SHA-256 for every delivered file. The evidence and the work itself stay
// with the client and the freelancer.
export default async function ProofPage(props: PageProps<'/m/[id]/proof'>) {
  await connection();
  const { id } = await props.params;
  const m = await readMilestone(id);
  if (!m) notFound();
  const paid = m.status === 'released';
  // A review made before the terms changed was against the old criteria.
  const review = currentReview(m);
  const findings = review ? latestFindings(m.criteria, review.findings) : [];
  const aiPaid = m.timeline.some((e) => e.type === 'verified');
  const captured = m.payment.capturedAmount ?? m.amount;
  const files = m.submissions.at(-1)?.attachments ?? [];
  // A certificate that hid a refund would vouch for more than happened.
  const refunded = (m.payment.refunds ?? []).filter((r) => r.status !== 'FAILED' && r.status !== 'CANCELLED').reduce((sum, r) => sum + Number(r.amount), 0);
  const how = m.payment.capturedAmount
    ? `Settled by agreement for ${fmtMoney(captured, m.currency)} of ${fmtMoney(m.amount, m.currency)}.`
    : aiPaid
      ? 'Paid by the AI reviewer, with no one clicking approve, after a second model confirmed every criterion.'
      : 'Approved and paid by the client after the AI review.';
  const reviewer =
    review?.engine === 'claude' ? `${modelName(review.model)}, live` : review?.engine === 'replay' ? `a replay of a real ${modelName(review.model)} run` : review ? 'the simulated reviewer' : 'no reviewer';
  return (
    <>
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="mx-auto w-full max-w-3xl px-6 pb-20 pt-10 print:pt-0">
        <div className="rounded-3xl border-2 border-pp-navy bg-white p-8 shadow-sm print:border print:shadow-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-pp-blue">Proof of Done · certificate of verified work</p>
              <h1 className="mt-3 font-display text-4xl leading-tight text-pp-navy">{m.title}</h1>
              <p className="mt-2 text-[15px] text-pp-muted">
                Delivered by <b className="text-pp-ink">{m.freelancer.name}</b> for <b className="text-pp-ink">{m.client.name}</b>
              </p>
            </div>
            <span aria-hidden className={`grid h-16 w-16 shrink-0 place-items-center rounded-full text-3xl font-black ${paid ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
              {paid ? '✓' : '…'}
            </span>
          </div>

          {!paid ? (
            <p className="mt-6 rounded-xl bg-pp-canvas px-4 py-3 text-[15px] text-pp-muted">
              This work hasn&apos;t been paid yet. The certificate is issued once PayPal captures the payment.
            </p>
          ) : (
            <>
              <dl className="mt-6 grid gap-4 sm:grid-cols-3">
                <Fact label="Paid" value={fmtMoney(captured, m.currency)} note={refunded > 0 ? `${fmtMoney(refunded, m.currency)} refunded since` : undefined} />
                {/* The day in big type and the time as the note: the full stamp wrapped onto two lines. */}
                <Fact label="On" value={m.payment.capturedAt ? fmtDay(m.payment.capturedAt) : '-'} note={m.payment.capturedAt && fmtTime(m.payment.capturedAt)} />
                <Fact label="PayPal capture" value={m.payment.captureId ?? '-'} mono note={m.payment.mode === 'sandbox' ? 'PayPal sandbox' : 'simulated'} />
              </dl>
              <p className="mt-4 text-[15px] leading-relaxed text-pp-ink">{how}</p>
              <SealNote seal={checkSeal(m)} anchor={m.payment.anchoredRecord} />
              {refunded > 0 && (
                <p className="mt-3 rounded-xl bg-orange-50 px-4 py-3 text-[15px] text-orange-900 ring-1 ring-inset ring-orange-200">
                  After the payment {m.client.name} reported a problem, and {fmtMoney(refunded, m.currency)}
                  {refunded >= Number(captured) ? ', the whole payment,' : ''} was refunded through PayPal.
                </p>
              )}
            </>
          )}

          <h2 className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-pp-muted">What had to be true · checked by {reviewer}</h2>
          <ul className="mt-3 space-y-2">
            {m.criteria.map((c, i) => {
              const f = findings[i];
              const met = f?.status === 'met' && f.confidence >= m.releaseThreshold;
              return (
                <li key={c.id} className="flex items-start gap-3 rounded-xl bg-pp-canvas/60 px-4 py-3 text-[15px]">
                  <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${met ? 'bg-emerald-500 text-white' : f ? 'bg-amber-400 text-white' : 'bg-slate-200 text-slate-500'}`}>{met ? '✓' : f ? '!' : '-'}</span>
                  <span className="flex-1">{c.text}</span>
                  <span className="shrink-0 text-xs font-semibold text-pp-muted">{f ? `${f.status.replace('_', ' ')} · ${Math.round(f.confidence * 100)}%` : 'not checked'}</span>
                </li>
              );
            })}
          </ul>
          {review?.audit && (
            <p className="mt-3 text-sm text-pp-muted">
              Second opinion ({review.audit.engine === 'claude' ? modelName(review.audit.model) : 'simulated'}): {review.audit.agreed ? 'confirmed every criterion' : 'did not confirm the release'}.
            </p>
          )}

          <h2 className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-pp-muted">What was delivered</h2>
          {files.length ? (
            <ul className="mt-3 space-y-2">
              {files.map((a, i) => (
                <li key={a.id} className="rounded-xl border border-pp-border px-4 py-3">
                  <div className="flex justify-between gap-3 text-sm">
                    <b className="min-w-0 truncate">{fileLabel(i, a.mime)}</b>
                    <span className="shrink-0 text-pp-muted">{(a.size / 1024).toFixed(1)} KB</span>
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px] text-pp-muted">SHA-256 {a.sha256 ?? 'not recorded (delivered before fingerprints were kept)'}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-pp-muted">Notes and links only, no files.</p>
          )}
          {files.some((a) => a.sha256) && <CheckFile hashes={files.flatMap((a, i) => (a.sha256 ? [{ name: fileLabel(i, a.mime), sha256: a.sha256 }] : []))} />}

          <p className="mt-8 border-t border-pp-border pt-4 text-xs leading-relaxed text-pp-muted">
            Certificate {m.id}. The reviewer&apos;s evidence, the notes, the file names and the work itself are visible only to the client and the freelancer, on{' '}
            <Link href={`/m/${m.id}`} className="text-pp-blue underline decoration-pp-blue/40 underline-offset-2 hover:decoration-pp-blue">
              the deal page
            </Link>
            . A hackathon project, not a licensed escrow service.
          </p>
        </div>
      </main>
    </>
  );
}

// The certificate is public, so files are named by type and position, not by their (possibly telling) names.
const fileLabel = (i: number, mime: string) => `File ${i + 1} · ${mime === 'application/pdf' ? 'PDF' : mime.startsWith('image/') ? 'image' : mime.startsWith('text/') ? 'text' : 'file'}`;

function Fact({ label, value, mono, note }: { label: string; value: string; mono?: boolean; note?: string }) {
  return (
    <div className="rounded-xl bg-pp-canvas/70 px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-pp-muted">{label}</dt>
      <dd suppressHydrationWarning className={`mt-1 break-all text-pp-navy ${mono ? 'font-mono text-xs' : 'text-lg font-bold'}`}>{value}</dd>
      {note && <dd className="mt-0.5 text-[11px] text-pp-muted">{note}</dd>}
    </div>
  );
}
