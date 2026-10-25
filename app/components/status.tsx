import type { MilestoneStatus } from '@/lib/escrow/types';

export const STATUS: Record<MilestoneStatus, { label: string; tone: string; hint: string }> = {
  awaiting_funding: { label: 'Awaiting funding', tone: 'bg-slate-100 text-slate-700 ring-slate-300', hint: 'The client has not put the money on hold yet.' },
  funded: { label: 'Funded · on hold', tone: 'bg-blue-50 text-pp-blue ring-blue-200', hint: 'PayPal is holding the money. Nothing has been charged.' },
  reviewing: { label: 'AI reviewing', tone: 'bg-violet-50 text-violet-700 ring-violet-200', hint: 'The reviewer is checking the work against the criteria.' },
  changes_requested: { label: 'Changes requested', tone: 'bg-amber-50 text-amber-800 ring-amber-200', hint: 'Something is missing. The freelancer can resubmit.' },
  escalated: { label: 'Needs client', tone: 'bg-orange-50 text-orange-800 ring-orange-200', hint: 'The reviewer could not verify everything. The client decides.' },
  released: { label: 'Paid', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200', hint: 'Captured on PayPal and paid out.' },
  cancelled: { label: 'Cancelled', tone: 'bg-rose-50 text-rose-700 ring-rose-200', hint: 'The hold was voided. Nothing was charged.' },
};

export function StatusBadge({ status }: { status: MilestoneStatus }) {
  const s = STATUS[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.tone}`}>{s.label}</span>;
}

export const fmtMoney = (amount: string | number, currency: string) =>
  Number(amount).toLocaleString('en-US', { style: 'currency', currency });

/** One fixed format on server and client (avoids locale-dependent hydration mismatches). */
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}
