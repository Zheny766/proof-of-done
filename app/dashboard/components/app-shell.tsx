'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/app/components/logo';
import { AgStudioLogo } from './ui/logo';

// The app frame, laid out like the PayPal Developer Dashboard: a white top bar, a left sidebar
// and a light canvas. Shared by the dashboard, its loading skeleton and its error page.

// Drawn as SVG text: it's a logo, so the light "Pal" is exempt from text contrast rules.
function PayPalWordmark({ className = '' }: { className?: string }) {
  return (
    <svg role="img" aria-label="PayPal" viewBox="0 0 54 20" className={`h-5 w-auto overflow-visible ${className}`}>
      <text x="0" y="15" fontSize="16" fontWeight="700" fontStyle="italic" letterSpacing="-0.4">
        <tspan fill="var(--pp-blue-dark)">Pay</tspan>
        <tspan fill="var(--pp-sky)">Pal</tspan>
      </text>
    </svg>
  );
}

function BrandLockup() {
  return (
    <div className="flex items-center gap-3">
      <Logo />
      <span className="h-6 w-px bg-pp-border" aria-hidden />
      <span className="flex items-center gap-1 text-xs text-pp-muted">
        escrow analytics in <AgStudioLogo className="-ml-1 h-9 w-auto" /> on <PayPalWordmark />
      </span>
    </div>
  );
}

function TopBar() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-6 border-b border-pp-border bg-white px-6">
      <BrandLockup />
      <nav className="ml-auto flex items-center gap-5 text-sm font-semibold text-pp-muted">
        <Link href="/demo" className="hover:text-pp-blue">Demo</Link>
        <Link href="/jobs" className="hover:text-pp-blue">Jobs for agents</Link>
        <Link href="/mine" className="hover:text-pp-blue">My deals</Link>
        <Link href="/dashboard" className="text-pp-blue">Escrow analytics</Link>
      </nav>
    </header>
  );
}

export function AppShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col bg-pp-canvas font-paypal text-pp-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-64 shrink-0 flex-col border-r border-pp-border bg-white" aria-label="Reports">
          {sidebar}
        </nav>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
