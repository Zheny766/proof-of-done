import Link from 'next/link';
import { paymentMode } from '@/lib/escrow/payments';
import { isClaudeConfigured } from '@/lib/ai';
import { REVIEW_MODEL } from '@/lib/escrow/reviewer';
import { Logo } from './logo';

export function SiteHeader() {
  const mode = paymentMode();
  const claude = isClaudeConfigured();
  return (
    <header className="border-b border-pp-border bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <Logo />
        <nav className="flex min-w-0 items-center gap-3.5 text-sm font-semibold text-pp-muted sm:gap-5">
          <Link href="/demo" className="hover:text-pp-blue">Demo</Link>
          <Link href="/jobs" className="hover:text-pp-blue">
            <span className="sm:hidden">Jobs</span>
            <span className="hidden sm:inline">Jobs for agents</span>
          </Link>
          <Link href="/mine" className="hover:text-pp-blue">
            <span className="sm:hidden">Mine</span>
            <span className="hidden sm:inline">My deals</span>
          </Link>
          <Link href="/dashboard" className="hover:text-pp-blue">
            <span className="sm:hidden">Analytics</span>
            <span className="hidden sm:inline">Escrow analytics</span>
          </Link>
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
