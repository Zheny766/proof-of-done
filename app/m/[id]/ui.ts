// Shared pieces of the deal page.

export const card = 'rounded-2xl border border-pp-border bg-white p-6 shadow-[0_1px_2px_rgba(0,20,53,0.04),0_8px_24px_-12px_rgba(0,20,53,0.12)]';
export const h2 = 'text-xs font-semibold uppercase tracking-[0.14em] text-pp-muted';
export const btn = {
  primary: 'inline-flex h-11 items-center justify-center rounded-full bg-pp-navy px-5 text-sm font-semibold text-white hover:bg-pp-blue-dark disabled:opacity-50',
  pay: 'inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50',
  ghost: 'inline-flex h-11 items-center justify-center rounded-full border border-pp-border bg-white px-5 text-sm font-semibold text-pp-ink hover:border-pp-blue disabled:opacity-50',
  warn: 'inline-flex h-11 items-center justify-center rounded-full border border-amber-400 bg-white px-5 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50',
  danger: 'inline-flex h-11 items-center justify-center rounded-full border border-rose-300 bg-white px-5 text-sm font-semibold text-pp-danger hover:bg-rose-50 disabled:opacity-50',
};
export const field = 'w-full rounded-xl border border-pp-border bg-white px-3.5 text-[15px] outline-none focus:border-pp-blue focus:ring-2 focus:ring-pp-highlight';

export const noSubscribe = () => () => {};
// Minute resolution keeps the snapshot stable between renders.
export const currentMinute = () => Math.floor(Date.now() / 60_000);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** "claude-opus-5-5" -> "Claude Opus 5.5" */
export const modelName = (id?: string) =>
  id ? `Claude ${id.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^\w/, (c) => c.toUpperCase())}` : '';
