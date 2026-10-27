import Link from 'next/link';

export function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-pp-navy text-sm font-black text-white">✓</span>
      <span className="hidden text-lg font-bold tracking-tight text-pp-navy min-[420px]:inline">
        Proof <span className="text-pp-blue">of Done</span>
      </span>
    </Link>
  );
}
