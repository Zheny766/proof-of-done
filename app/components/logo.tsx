import Link from 'next/link';

/** The mark: three AI checks (violet, electric, mint) converge, and only then the tick. Same drawing as app/icon.svg. */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="8" fill="#07142d" />
      <g fill="none" strokeLinecap="round" strokeWidth="2">
        <path d="M6 8.5 12.5 17" stroke="#8c76ff" />
        <path d="M5 17h7.5" stroke="#5b8cff" />
        <path d="M6 25.5 12.5 17" stroke="#b2f5db" />
      </g>
      <path d="M12.5 17l3.6 3.6 8.4-9.6" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap" aria-label="Proof of Done, home">
      <LogoMark />
      <span className="hidden text-lg font-bold tracking-tight text-pp-navy min-[420px]:inline">
        Proof <span className="text-pod-electric">of Done</span>
      </span>
    </Link>
  );
}
