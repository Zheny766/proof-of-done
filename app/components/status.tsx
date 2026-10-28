import type { MilestoneStatus } from '@/lib/escrow/types';

export const STATUS: Record<MilestoneStatus, { label: string; tone: string; hint: string }> = {
  awaiting_funding: { label: 'Awaiting funding', tone: 'bg-slate-100 text-slate-700 ring-slate-300', hint: 'The client has not put the money on hold yet.' },
  funded: { label: 'Funded · on hold', tone: 'bg-blue-50 text-pp-blue ring-blue-200', hint: 'PayPal is holding the money. Nothing has been charged.' },
  reviewing: { label: 'AI reviewing', tone: 'bg-violet-50 text-violet-700 ring-violet-200', hint: 'The reviewer is checking the work against the criteria.' },
  changes_requested: { label: 'Changes requested', tone: 'bg-amber-50 text-amber-800 ring-amber-200', hint: 'Something is missing. The freelancer can resubmit.' },
  escalated: { label: 'Needs client', tone: 'bg-orange-50 text-orange-800 ring-orange-200', hint: 'The AI did not clear it for payment on its own. The client decides; the money stays on hold.' },
  verified: { label: 'Verified · releasing', tone: 'bg-teal-50 text-teal-800 ring-teal-200', hint: 'The AI verified the work. The payment goes out when the objection window closes.' },
  released: { label: 'Paid', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200', hint: 'Captured on PayPal and paid out.' },
  cancelled: { label: 'Cancelled', tone: 'bg-rose-50 text-rose-700 ring-rose-200', hint: 'The hold was voided. Nothing was charged.' },
};

export function StatusBadge({ status }: { status: MilestoneStatus }) {
  const s = STATUS[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.tone}`}>{s.label}</span>;
}

export const fmtMoney = (amount: string | number, currency: string) =>
  Number(amount).toLocaleString('en-US', { style: 'currency', currency });

/**
 * One fixed format on server and client, in UTC and saying so: the server renders the page, and with
 * no zone given a visitor read the host's clock as their own.
 */
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });

/** After a capture, what happened to the freelancer's payout, in words (PayPal says SUCCESS, PENDING, ...). */
export function payoutText(status: string | undefined, to: string): string {
  if (!status || status === 'SUCCESS') return `PayPal captured the hold and paid ${to}.`;
  if (status === 'PENDING' || status === 'PROCESSING') return `PayPal captured the hold; the payout to ${to} is on its way.`;
  if (status.startsWith('HELD')) return `PayPal is still completing the capture; the payout to ${to} goes out once it does.`;
  const why = status.replace(/^(FAILED|NOT SENT): /, '');
  return `PayPal captured the hold, but the payout to ${to} did not go through (${/^[A-Z_ ]+$/.test(why) ? why.toLowerCase() : why}).`;
}

/** Header that proves which party is acting (the key from their milestone link). */
export const keyHeader = (key: string | null): Record<string, string> => (key ? { 'x-milestone-key': key } : {});

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}
