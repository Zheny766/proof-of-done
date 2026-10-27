'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Milestone, Role } from '@/lib/escrow/types';
import { api, fmtMoney, keyHeader, STATUS, StatusBadge } from '@/app/components/status';

type Saved = { client?: string; freelancer?: string };
type Row = { m: Milestone; role: Exclude<Role, 'viewer'> };

// The deal pages keep each deal's keys under pod:keys:<id>; read them all and ask the server for each.
function savedDeals(): [string, Saved][] {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith('pod:keys:'))
      .map((k) => [k.slice('pod:keys:'.length), JSON.parse(localStorage.getItem(k) ?? '{}') as Saved]);
  } catch {
    return [];
  }
}

export function MyDeals() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all(
      savedDeals().map(async ([id, keys]) => {
        const key = keys.client ?? keys.freelancer;
        if (!key) return null;
        try {
          const { milestone, role } = await api<{ milestone: Milestone; role: Role }>(`/api/escrow/milestones/${id}`, { headers: keyHeader(key) });
          return role === 'viewer' ? null : { m: milestone, role };
        } catch {
          return null;
        }
      }),
    ).then((all) => alive && setRows(all.filter((r): r is Row => !!r).sort((a, b) => b.m.updatedAt.localeCompare(a.m.updatedAt))));
    return () => {
      alive = false;
    };
  }, []);

  if (!rows) return <p className="mt-10 text-pp-muted">Loading your deals…</p>;
  if (!rows.length) {
    return (
      <div className="mt-10 rounded-2xl border border-pp-border bg-white p-8 text-[15px] text-pp-muted">
        Nothing here yet. <Link href="/#create" className="font-semibold text-pp-blue hover:underline">Create a deal</Link>, take one from the{' '}
        <Link href="/jobs" className="font-semibold text-pp-blue hover:underline">job board</Link>, or{' '}
        <Link href="/demo" className="font-semibold text-pp-blue hover:underline">try the demo</Link>.
      </div>
    );
  }
  const paying = rows.filter((r) => r.role === 'client');
  const earning = rows.filter((r) => r.role === 'freelancer');
  const held = paying.filter((r) => ['funded', 'reviewing', 'changes_requested', 'escalated', 'verified'].includes(r.m.status)).reduce((s, r) => s + Number(r.m.amount), 0);
  const earned = earning.filter((r) => r.m.status === 'released').reduce((s, r) => s + Number(r.m.payment.capturedAmount ?? r.m.amount), 0);
  return (
    <>
      <div className="mt-8 grid max-w-xl grid-cols-2 gap-3">
        <Stat label="You have on hold" value={fmtMoney(held, 'USD')} />
        <Stat label="You were paid" value={fmtMoney(earned, 'USD')} />
      </div>
      {[
        ['You pay', paying],
        ['You get paid', earning],
      ].map(([title, list]) =>
        (list as Row[]).length ? (
          <section key={title as string} className="mt-10">
            <h2 className="font-display text-3xl text-pp-navy">{title as string}</h2>
            <ul className="mt-4 grid gap-4 lg:grid-cols-2">
              {(list as Row[]).map(({ m, role }) => (
                <li key={m.id}>
                  <Link href={`/m/${m.id}`} className="flex h-full flex-col rounded-2xl border border-pp-border bg-white p-5 shadow-sm hover:border-pp-blue">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={m.status} />
                          {m.demo && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">demo</span>}
                          {m.board && <span className="rounded-full bg-pp-highlight px-2 py-0.5 text-[11px] font-semibold text-pp-blue">job board</span>}
                        </div>
                        <div className="mt-2 font-display text-2xl leading-tight text-pp-navy">{m.title}</div>
                        <div className="mt-1 text-sm text-pp-muted">{role === 'client' ? `for ${m.freelancer.name}` : `from ${m.client.name}`}</div>
                      </div>
                      <div className="shrink-0 font-display text-3xl tabular-nums text-pp-navy">{fmtMoney(m.payment.capturedAmount ?? m.amount, m.currency)}</div>
                    </div>
                    <p className="mt-3 text-sm text-pp-muted">{STATUS[m.status].hint}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-pp-border bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-pp-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-pp-navy">{value}</div>
    </div>
  );
}
