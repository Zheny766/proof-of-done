import Link from 'next/link';
import { paymentMode } from '@/lib/escrow/payments';
import { isClaudeConfigured } from '@/lib/ai';
import { REVIEW_MODEL } from '@/lib/escrow/reviewer';

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-pp-navy text-sm font-black text-white">✓</span>
      <span className="text-lg font-bold tracking-tight text-pp-navy">
        Proof <span className="text-pp-blue">of Done</span>
      </span>
    </Link>
  );
}

export function SiteHeader() {
  const mode = paymentMode();
  const claude = isClaudeConfigured();
  return (
    <header className="border-b border-pp-border bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <Logo />
        <nav className="flex items-center gap-5 text-sm font-semibold text-pp-muted">
          <Link href="/" className="hover:text-pp-blue">Milestones</Link>
          <Link href="/dashboard" className="hover:text-pp-blue">Escrow analytics</Link>
          <span className="hidden items-center gap-2 sm:flex">
            <span className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${mode === 'sandbox' ? 'bg-blue-50 text-pp-blue ring-blue-200' : 'bg-slate-100 text-slate-600 ring-slate-300'}`}>
              PayPal {mode === 'sandbox' ? 'sandbox' : 'simulated'}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${claude ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-slate-100 text-slate-600 ring-slate-300'}`}>
              {claude ? `Reviewer: ${REVIEW_MODEL}` : 'Reviewer: simulated'}
            </span>
          </span>
        </nav>
      </div>
    </header>
  );
}
