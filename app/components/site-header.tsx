import Link from 'next/link';
import { connection } from 'next/server';
import { paymentMode } from '@/lib/escrow/payments';
import { isClaudeConfigured } from '@/lib/ai';
import { REVIEW_MODEL } from '@/lib/escrow/reviewer';
import { modelName } from '@/app/m/[id]/ui';
import { Logo } from './logo';

export async function SiteHeader() {
  // Read when the page is served, not when it was built: the build machine's keys say nothing about
  // whether this server runs on the PayPal sandbox or with a live reviewer.
  await connection();
  const mode = paymentMode();
  const claude = isClaudeConfigured();
  return (
    <header className="border-b border-pp-border bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <Logo />
        {/* Each link is 44px tall, a thumb-sized target on a phone. */}
        <nav className="flex min-w-0 items-center gap-3.5 text-sm font-semibold text-pp-muted sm:gap-5">
          <Link href="/demo" className="inline-flex h-11 items-center hover:text-pp-blue">Demo</Link>
          <Link href="/jobs" className="inline-flex h-11 items-center hover:text-pp-blue">
            <span className="sm:hidden">Jobs</span>
            <span className="hidden sm:inline">Jobs for agents</span>
          </Link>
          <Link href="/mine" className="inline-flex h-11 items-center hover:text-pp-blue">
            <span className="sm:hidden">Mine</span>
            <span className="hidden sm:inline">My deals</span>
          </Link>
          <Link href="/dashboard" className="inline-flex h-11 items-center hover:text-pp-blue">
            <span className="sm:hidden">Analytics</span>
            <span className="hidden sm:inline">Escrow analytics</span>
          </Link>
          {/* One honest indicator of what this server runs; the details are in its tooltip. */}
          <span
            title={`Payments: ${mode === 'sandbox' ? 'real PayPal sandbox' : 'simulated (no PayPal keys)'} · Reviewer: ${claude ? `${modelName(REVIEW_MODEL)}, live` : 'replays of real Claude runs and a simulated stand-in'}`}
            className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset sm:inline-flex ${
              mode === 'sandbox' && claude ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-300'
            }`}
          >
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${mode === 'sandbox' && claude ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {mode === 'sandbox' && claude ? 'Live: PayPal sandbox + AI' : mode === 'sandbox' ? 'PayPal sandbox · demo reviewer' : claude ? 'Demo payments · live AI' : 'Demo mode'}
          </span>
        </nav>
      </div>
    </header>
  );
}
