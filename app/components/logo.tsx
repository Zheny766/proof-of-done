import Link from 'next/link';

/** The mark: three AI checks (violet, electric, mint) converge, and only then the tick. Same drawing as app/icon.svg. */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="8" fill="#07142d" />
      <g fill="none" strokeLinecap="round" strokeWidth="2.2">
        <path d="M7 8.5 13 17" stroke="#8c76ff" />
        <path d="M6.5 17H13" stroke="#5b8cff" />
        <path d="M7 25.5 13 17" stroke="#b2f5db" />
      </g>
      <circle cx="7" cy="8.5" r="2.2" fill="#8c76ff" />
      <circle cx="6.3" cy="17" r="2.2" fill="#5b8cff" />
      <circle cx="7" cy="25.5" r="2.2" fill="#b2f5db" />
      <path d="M13 17l3.4 3.4 8.6-9.8" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
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
