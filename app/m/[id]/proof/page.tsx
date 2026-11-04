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
import { LogoMark } from '@/app/components/logo';

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
      ? 'Paid by the AI reviewer, with no one clicking approve, after the independent checks confirmed every criterion.'
      : 'Approved and paid by the client after the AI review.';
  // Who signed off, in order: the reviewer, Claude's second opinion, then Gemini's check.
  const signatures = review
    ? [
        { role: 'Reviewer', name: review.engine === 'claude' || review.engine === 'replay' ? modelName(review.model) : 'Simulated reviewer', ok: review.decision === 'release' || paid, note: review.decision === 'release' ? 'decided to pay' : 'reviewed' },
        ...(review.audit ? [{ role: 'Second opinion', name: review.audit.engine === 'claude' ? modelName(review.audit.model) : 'Simulated check', ok: review.audit.agreed, note: review.audit.agreed ? 'confirmed every criterion' : 'did not confirm' }] : []),
        ...(review.panel ?? []).map((a) => ({ role: 'Third check · Google', name: modelName(a.model), ok: a.agreed, note: a.unavailable ? 'could not answer' : a.agreed ? 'confirmed every criterion' : 'did not confirm' })),
      ]
    : [];
  const seal = checkSeal(m);
  const reviewer =
    review?.engine === 'claude' ? `${modelName(review.model)}, live` : review?.engine === 'replay' ? `a replay of a real ${modelName(review.model)} run` : review ? 'the simulated reviewer' : 'no reviewer';
  return (
    <>
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="mx-auto w-full max-w-3xl px-6 pb-20 pt-10 print:pt-0">
        <div className="overflow-hidden rounded-3xl bg-white shadow-[0_30px_60px_-30px_rgba(7,20,45,0.35)] ring-1 ring-pp-border print:shadow-none">
          <div className="relative bg-pod-midnight px-8 pt-7 pb-8 text-white print:bg-white print:text-pp-ink">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:24px_24px] print:hidden" />
            <div className="relative flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-white/60 print:text-pp-muted">
                  <LogoMark className="h-5 w-5" /> Proof of Done · certificate of verified work
                </p>
                <p className={`mt-5 font-display text-6xl leading-none sm:text-7xl ${paid ? 'text-pod-mint print:text-emerald-700' : 'text-white/60'}`}>{paid ? 'Verified.' : 'Not paid yet'}</p>
                <h1 className="mt-4 text-2xl font-semibold tracking-tight">{m.title}</h1>
                <p className="mt-1.5 text-[15px] text-white/70 print:text-pp-muted">
                  Delivered by <b className="text-white print:text-pp-ink">{m.freelancer.name}</b> for <b className="text-white print:text-pp-ink">{m.client.name}</b>
                </p>
              </div>
              <span aria-hidden className={`grid h-20 w-20 shrink-0 place-items-center rounded-full text-4xl font-black ring-8 ${paid ? 'bg-pod-mint text-pod-midnight ring-pod-mint/15' : 'bg-white/10 text-white/50 ring-white/5'}`}>
                {paid ? '✓' : '…'}
              </span>
            </div>
            {seal.head && (
              <div className="relative mt-6 rounded-xl bg-white/[0.06] px-4 py-3 ring-1 ring-inset ring-white/10 print:bg-pp-canvas print:ring-pp-border">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50 print:text-pp-muted">Record fingerprint · SHA-256</div>
                <div className="mt-1 break-all font-mono text-[13px] text-white/90 print:text-pp-ink">{seal.head}</div>
              </div>
            )}
          </div>
          <div className="p-8">
          {!paid ? (
            <p className="rounded-xl bg-pp-canvas px-4 py-3 text-[15px] text-pp-muted">
              This work hasn&apos;t been paid yet. The certificate is issued once PayPal captures the payment.
            </p>
          ) : (
            <>
              <dl className="grid gap-4 sm:grid-cols-3">
                <Fact label="Paid" value={fmtMoney(captured, m.currency)} note={refunded > 0 ? `${fmtMoney(refunded, m.currency)} refunded since` : undefined} />
                {/* The day in big type and the time as the note: the full stamp wrapped onto two lines. */}
                <Fact label="On" value={m.payment.capturedAt ? fmtDay(m.payment.capturedAt) : '-'} note={m.payment.capturedAt && fmtTime(m.payment.capturedAt)} />
                <Fact label="PayPal capture" value={m.payment.captureId ?? '-'} mono note={m.payment.mode === 'sandbox' ? 'PayPal sandbox' : 'simulated'} />
              </dl>
              <p className="mt-4 text-[15px] leading-relaxed text-pp-ink">{how}</p>
              <SealNote seal={seal} anchor={m.payment.anchoredRecord} />
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
              // A matter of taste: the client judged it, by paying or by letting the window close.
              if (c.judge === 'client') {
                return (
                  <li key={c.id} className="flex items-start gap-3 rounded-xl bg-amber-50/60 px-4 py-3 text-[15px]">
                    <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${paid ? 'bg-amber-400 text-white' : 'bg-slate-200 text-slate-500'}`}>{paid ? '✓' : '-'}</span>
                    <span className="flex-1">{c.text}</span>
                    <span className="shrink-0 text-xs font-semibold text-amber-800">{paid ? 'accepted by the client' : 'the client’s call'}</span>
                  </li>
                );
              }
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
          {signatures.length > 0 && (
            <>
              <h2 className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-pp-muted">Signed off by</h2>
              <ol className="mt-3 grid gap-3 sm:grid-cols-3">
                {signatures.map((s) => (
                  <li key={s.role} className="rounded-xl border border-pp-border px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pp-muted">{s.role}</div>
                    <div className="mt-1 text-[15px] font-semibold text-pp-ink">{s.name}</div>
                    <div className="mt-2 border-t border-dashed border-pp-border pt-2 text-xs font-semibold">
                      <span className={s.ok ? 'text-emerald-700' : 'text-orange-700'}>{s.ok ? '✓' : '!'} {s.note}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </>
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
