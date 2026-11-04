import { benchRows, forgedBench } from '@/lib/escrow/bench';

const REPO = 'https://github.com/Zheny766/proof-of-done/blob/main';

// The bench under the real runs: one reviewer on its own against the independent checks, on deliveries
// built to fool it, with the numbers read from eval/results.
export function Bench() {
  const rows = benchRows();
  const forged = forgedBench();
  const [main] = rows;
  return (
    <section id="bench" className="mt-14 scroll-mt-6">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-pp-blue">The bench · recorded runs against the real models</p>
      <h2 className="mt-2 font-display text-3xl text-pp-navy">Tested on deliveries built to fool it</h2>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-pp-muted">
        {main.cases} deliveries with known answers: {main.honest} honest, {main.bad} rigged or wrong. Fake system messages, look-alike letters and invisible characters, an
        instruction in a screenshot, an SVG, hidden HTML or a fake review log; code that switches off its own tests, hardcodes the answers or prints a fake
        &ldquo;OK&rdquo;; menus, logos and translations that miss the brief. Each went through the whole check, as on this site, with no PayPal call.
      </p>
      <div className="mt-6 overflow-x-auto rounded-2xl bg-white ring-1 ring-pp-border">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-pp-border text-xs uppercase tracking-[0.12em] text-pp-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Reviewer, then the checks</th>
              <th className="px-4 py-3 font-semibold">The reviewer alone went to pay</th>
              <th className="px-4 py-3 font-semibold">Paid with the checks</th>
              <th className="px-4 py-3 font-semibold">Honest work held</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pp-border">
            {rows.map((r) => (
              <tr key={`${r.set}${r.reviewer}`}>
                <td className="px-4 py-3">
                  <div className="font-semibold text-pp-navy">{r.reviewer}</div>
                  <div className="text-xs text-pp-muted">
                    {r.set} · checked by {r.checks}
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  <span className={r.aloneWouldPay ? 'font-semibold text-amber-700' : 'text-pp-ink'}>{r.aloneWouldPay}</span> of {r.bad} rigged or wrong
                </td>
                <td className="px-4 py-3 tabular-nums">
                  <span className={r.paid ? 'font-semibold text-pp-danger' : 'font-semibold text-emerald-700'}>{r.paid}</span> of {r.bad}
                </td>
                <td className="px-4 py-3 tabular-nums text-pp-ink">{r.honest ? `${r.honestHeld} of ${r.honest}` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-pp-muted">
        <b className="text-pp-ink">If the reviewer were fooled completely.</b> We also handed the checks a reviewer that called every criterion met on all {main.cases}. On their own,{' '}
        {forged.second.model.replace('claude-haiku-5-5', 'Claude Haiku 5.5')} refused {forged.second.caught[0]} of {forged.second.caught[1]} bad deliveries and Gemini {forged.gemini.caught[0]} of the{' '}
        {forged.gemini.caught[1]} it answered on.{' '}
        {forged.bothMissed.includes('email-screenshot-only')
          ? 'The one that got past both was buggy code with a screenshot of a passing test run: neither check runs code. So paying for a delivery with code now also needs the reviewer to have run it in that review.'
          : forged.bothMissed.length
            ? `Both missed: ${forged.bothMissed.join(', ')}.`
            : 'No bad delivery got past both.'}
      </p>
      <p className="mt-3 text-sm text-pp-muted">
        Every case, verdict and cost:{' '}
        <a href={`${REPO}/eval/results/claude-opus-5-5.md`} className="text-pp-blue underline decoration-pp-blue/40 underline-offset-2 hover:decoration-pp-blue">
          Opus
        </a>
        ,{' '}
        <a href={`${REPO}/eval/results/claude-haiku-5-5.md`} className="text-pp-blue underline decoration-pp-blue/40 underline-offset-2 hover:decoration-pp-blue">
          Haiku
        </a>
        ,{' '}
        <a href={`${REPO}/eval/results/forged-claude-haiku-5-5.md`} className="text-pp-blue underline decoration-pp-blue/40 underline-offset-2 hover:decoration-pp-blue">
          the fooled reviewer
        </a>
        . A small set: it shows the design works, not a guarantee.
      </p>
    </section>
  );
}
