'use client';

import { useState, type ReactNode } from 'react';
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
      <span className="hidden h-6 w-px bg-pp-border lg:block" aria-hidden />
      <span className="hidden items-center gap-1 text-xs text-pp-muted lg:flex">
        escrow analytics in <AgStudioLogo className="-ml-1 h-9 w-auto" /> on <PayPalWordmark />
      </span>
    </div>
  );
}

const LINKS = [
  { href: '/demo', label: 'Demo' },
  { href: '/jobs', label: 'Jobs for agents' },
  { href: '/mine', label: 'My deals' },
];

function TopBar({ menuOpen, onMenu }: { menuOpen: boolean; onMenu: () => void }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-pp-border bg-white px-4 md:gap-6 md:px-6">
      <BrandLockup />
      <button
        type="button"
        onClick={onMenu}
        aria-expanded={menuOpen}
        aria-controls="dashboard-nav"
        className="ml-auto rounded-full border border-pp-border px-4 py-2 text-sm font-semibold text-pp-navy md:hidden"
      >
        {menuOpen ? 'Close' : 'Reports & pages'}
      </button>
      <nav className="ml-auto hidden items-center gap-5 text-sm font-semibold text-pp-muted md:flex">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="hover:text-pp-blue">
            {l.label}
          </Link>
        ))}
        <Link href="/dashboard" className="text-pp-blue">Escrow analytics</Link>
      </nav>
    </header>
  );
}

// On a phone the reports sidebar becomes a drawer, so the report gets the whole width.
export function AppShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-dvh flex-col bg-pp-canvas font-paypal text-pp-ink">
      <TopBar menuOpen={open} onMenu={() => setOpen(!open)} />
      <div className="flex min-h-0 flex-1">
        {open && <div className="fixed inset-0 top-16 z-30 bg-pp-ink/30 md:hidden" onClick={() => setOpen(false)} aria-hidden />}
        <nav
          id="dashboard-nav"
          aria-label="Reports"
          onClickCapture={(e) => {
            if ((e.target as Element).closest('[data-nav-select]')) setOpen(false);
          }}
          className={`${open ? 'flex' : 'hidden'} fixed bottom-0 left-0 top-16 z-40 w-72 max-w-[85vw] flex-col border-r border-pp-border bg-white shadow-xl md:static md:z-auto md:flex md:w-64 md:max-w-none md:shrink-0 md:shadow-none`}
        >
          <div className="flex gap-4 border-b border-pp-border px-6 py-3 text-sm font-semibold text-pp-muted md:hidden">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-pp-blue">
                {l.label}
              </Link>
            ))}
          </div>
          {sidebar}
        </nav>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
