'use client';

// Three more custom Studio widgets, each about the money: where it went, what stood between the AI
// and a payout, and which holds need attention before PayPal's guarantee runs out. Like the pipeline,
// they read through widgetApi.getData, so the page's filters and cross-filters apply to them.

/* eslint-disable @typescript-eslint/no-explicit-any -- AG Studio's widget registry types are generic over a custom registry */
import { useEffect, useState } from 'react';
import type { AgWidgetParams } from 'ag-studio';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const oneLine = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

// Studio rows are keyed by field; read a field's value by key or id, falling back to position.
export function valueOf(row: Record<string, any>, field: { id?: string; fieldId?: string; key?: string }, index: number) {
  const id = field.id ?? field.fieldId ?? '';
  if (field.key && field.key in row) return row[field.key];
  if (id in row) return row[id];
  const key = Object.keys(row).find((k) => id && k.includes(id));
  return key ? row[key] : Object.values(row)[index];
}

/** The rows for the mapped fields, with the widget's loading / no-data states handled. */
function useRows(props: AgWidgetParams<any>, keys: string[]) {
  const { dataMapping, widgetApi } = props as any;
  const [rows, setRows] = useState<Record<string, any>[] | null>(null);
  useEffect(() => {
    let active = true;
    const fields = keys.map((k) => dataMapping?.[k]?.[0]);
    if (fields.some((f) => !f)) {
      widgetApi.setDisplayState('incompleteDataMapping');
      return;
    }
    widgetApi.setDisplayState('loading');
    let last = '';
    const load = () =>
      widgetApi
        .getData({ fields })
        .then((response: any) => {
          if (!active) return;
          const got: Record<string, any>[] = response?.results?.rows ?? [];
          // Each row as { mappingKey: value }.
          const named = got.map((r) => Object.fromEntries(keys.map((k, i) => [k, valueOf(r, fields[i], i)])));
          const json = JSON.stringify(named);
          if (json === last) return;
          last = json;
          setRows(named);
          widgetApi.setDisplayState(named.length ? 'displayed' : 'noData');
        })
        .catch((error: unknown) => {
          console.warn('[escrow-widget]', error);
          if (active) widgetApi.setDisplayState('noData');
        });
    void load();
    // Studio tells a custom widget nothing when another widget cross-filters the page or a filter
    // changes, so it asks again now and then (the data lives in the browser, the query is cheap) and
    // redraws only when the answer changed.
    const watch = setInterval(() => void load(), 1500);
    return () => {
      active = false;
      clearInterval(watch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataMapping, widgetApi]);
  return rows;
}

const field = (role: 'category' | 'numeric', aiDescription: string) => ({ type: 'field', supportedRoles: [role], requires: { cardinality: 'one' }, required: true, aiDescription });
const form = (items: [string, string][]) => (params: any) => params.createDefaults({ dataMappingItems: items.map(([key, label]) => ({ key, label })) });

// ---- Where the money went -------------------------------------------------------------------------

function MoneyFlowWidget(props: AgWidgetParams<any>) {
  const rows = useRows(props, ['paid', 'refunded', 'voided', 'held']);
  if (!rows?.length) return null;
  const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const refunded = sum('refunded');
  const parts = [
    { label: 'Paid to freelancers', value: sum('paid') - refunded, color: 'var(--pp-chart-8)', note: refunded ? `after ${money(refunded)} refunded` : 'captured and paid out' },
    { label: 'Back with clients', value: sum('voided') + refunded, color: 'var(--pp-chart-10)', note: 'voided holds, settlement remainders, refunds' },
    { label: 'Still on hold', value: sum('held'), color: 'var(--pp-chart-1)', note: 'authorized on PayPal, not charged' },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, padding: '2px 4px', fontFamily: 'var(--pp-font)' }}>
      <div style={{ display: 'flex', flexShrink: 0, height: 14, borderRadius: 999, overflow: 'hidden', background: 'var(--pp-canvas)' }} role="img" aria-label={parts.map((p) => `${p.label} ${money(p.value)}`).join(', ')}>
        {parts.map((p) => p.value > 0 && <div key={p.label} title={`${p.label}: ${money(p.value)}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        {parts.map((p) => (
          <div key={p.label} style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--pp-muted)' }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
              <span style={oneLine}>{p.label}</span>
            </div>
            <div style={{ marginTop: 2, fontSize: 22, fontWeight: 700, color: 'var(--pp-ink)' }}>{money(p.value)}</div>
            <div style={{ ...oneLine, fontSize: 11, color: 'var(--pp-muted)' }}>
              {Math.round((p.value / total) * 100)}% · {p.note}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const moneyFlowWidget: any = {
  id: 'escrow-money-flow',
  label: 'Where the money went',
  icon: { url: '/icon.svg' },
  dataMapping: {
    paid: field('numeric', 'Money captured and paid out to freelancers'),
    refunded: field('numeric', 'Money refunded to clients after a payment'),
    voided: field('numeric', 'Money that went back to clients without a capture: voided holds and settlement remainders'),
    held: field('numeric', 'Money still on hold with PayPal'),
  },
  form: form([['paid', 'Paid out'], ['refunded', 'Refunded'], ['voided', 'Back to clients'], ['held', 'On hold']]),
  comp: MoneyFlowWidget,
  defaultSize: { width: 900, height: 150 },
};

// ---- The release gate -----------------------------------------------------------------------------

function ReleaseGateWidget(props: AgWidgetParams<any>) {
  const rows = useRows(props, ['outcome', 'count']);
  if (!rows?.length) return null;
  const count = (match: (o: string) => boolean) => rows.filter((r) => match(String(r.outcome))).reduce((s, r) => s + Number(r.count ?? 0), 0);
  const reviews = count(() => true);
  const wanted = count((o) => o !== 'Not asked');
  const confirmed = count((o) => o === 'Confirmed');
  const refused = count((o) => o.startsWith('Refused'));
  const flagged = count((o) => o === 'Refused: red flag');
  const steps = [
    { label: 'AI reviews', value: reviews, note: 'every delivery checked against its criteria', color: 'var(--pp-chart-2)' },
    { label: 'Reviewer moved to pay', value: wanted, note: 'every criterion met above the client’s threshold', color: 'var(--pp-chart-1)' },
    { label: 'Second model confirmed', value: confirmed, note: 'only now can PayPal capture', color: 'var(--pp-chart-8)' },
  ];
  const top = reviews || 1;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, padding: '4px 4px', fontFamily: 'var(--pp-font)' }}>
      {steps.map((s) => (
        <div key={s.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
            <span style={{ ...oneLine, fontWeight: 600, color: 'var(--pp-ink)' }}>{s.label}</span>
            <span style={{ fontWeight: 700, color: 'var(--pp-ink)' }}>{s.value}</span>
          </div>
          <div style={{ marginTop: 4, height: 10, borderRadius: 999, background: 'var(--pp-canvas)' }}>
            <div style={{ height: '100%', width: `${Math.max(2, (s.value / top) * 100)}%`, borderRadius: 999, background: s.color }} />
          </div>
          <div style={{ ...oneLine, marginTop: 2, fontSize: 11, color: 'var(--pp-muted)' }}>{s.note}</div>
        </div>
      ))}
      <div style={{ marginTop: 2, borderRadius: 10, padding: '8px 10px', fontSize: 12, background: refused ? 'color-mix(in srgb, var(--pp-chart-4) 14%, transparent)' : 'var(--pp-canvas)', color: 'var(--pp-ink)' }}>
        <b>{refused}</b> {refused === 1 ? 'release was' : 'releases were'} stopped by the second model{flagged ? `, ${flagged} of them for an attempt to steer the reviewer` : ''}.
      </div>
    </div>
  );
}

export const releaseGateWidget: any = {
  id: 'escrow-release-gate',
  label: 'Release gate',
  icon: { url: '/icon.svg' },
  dataMapping: {
    outcome: field('category', 'What the second opinion said on each review: Not asked, Confirmed, or Refused'),
    count: field('numeric', 'How many reviews'),
  },
  form: form([['outcome', 'Second opinion'], ['count', 'Reviews']]),
  comp: ReleaseGateWidget,
  defaultSize: { width: 420, height: 300 },
};

// ---- Holds that need attention --------------------------------------------------------------------

const HOUR = 3_600_000;
function holdBadge(honorEndsAt: string | null, renewed: boolean, now: number): [string, string] {
  if (!honorEndsAt) return ['no PayPal hold details', 'var(--pp-muted)'];
  const left = Date.parse(honorEndsAt) - now;
  if (left <= 0) return renewed ? ['the renewed guarantee has ended too', '#b42318'] : ["PayPal's 3-day guarantee is over: renewed when the deal is next opened", '#b42318'];
  const hours = Math.round(left / HOUR);
  return [hours < 48 ? `guarantee ends in ${hours} h` : `guarantee ends in ${Math.round(hours / 24)} days`, hours < 24 ? '#b54708' : 'var(--pp-muted)'];
}

function HoldsWidget(props: AgWidgetParams<any>) {
  const rows = useRows(props, ['id', 'title', 'amount', 'honorEndsAt', 'expiresAt', 'renewed']);
  const [now] = useState(() => Date.now());
  if (!rows) return null;
  const holds = rows
    .filter((r) => Number(r.amount) > 0)
    .map((r): Record<string, any> => ({ ...r, honor: r.honorEndsAt ? new Date(r.honorEndsAt).toISOString() : null, expires: r.expiresAt ? new Date(r.expiresAt).toISOString() : null }))
    .sort((a, b) => (a.honor ?? '9').localeCompare(b.honor ?? '9'));
  if (!holds.length) return <div style={{ padding: 12, fontSize: 13, color: 'var(--pp-muted)', fontFamily: 'var(--pp-font)' }}>No money on hold right now.</div>;
  return (
    <div style={{ height: '100%', overflowY: 'auto', fontFamily: 'var(--pp-font)' }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {holds.map((h) => {
          const [badge, color] = holdBadge(h.honor, h.renewed === true || h.renewed === 'true', now);
          const days = h.expires ? Math.max(0, Math.round((Date.parse(h.expires) - now) / (24 * HOUR))) : null;
          return (
            <li key={String(h.id)} style={{ borderBottom: '1px solid var(--pp-border)' }}>
              <a href={`/m/${h.id}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 6px', textDecoration: 'none', color: 'inherit' }}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ ...oneLine, display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--pp-ink)' }}>{String(h.title)}</span>
                  <span style={{ ...oneLine, display: 'block', fontSize: 11, color }}>
                    {badge}
                    {days !== null ? ` · authorization expires in ${days} days` : ''}
                  </span>
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pp-ink)' }}>{money(Number(h.amount))}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export const holdsWidget: any = {
  id: 'escrow-holds',
  label: 'Holds that need attention',
  icon: { url: '/icon.svg' },
  dataMapping: {
    id: field('category', 'The deal id, used to open the deal'),
    title: field('category', 'The deal title'),
    amount: field('numeric', 'Money on hold'),
    honorEndsAt: field('category', "When PayPal's 3-day guarantee on the hold ends"),
    expiresAt: field('category', 'When the PayPal authorization expires (29 days)'),
    renewed: field('category', 'Whether the hold was reauthorized after the 3-day guarantee'),
  },
  form: form([['id', 'Deal'], ['title', 'Title'], ['amount', 'On hold'], ['honorEndsAt', 'Guarantee ends'], ['expiresAt', 'Hold expires'], ['renewed', 'Renewed']]),
  comp: HoldsWidget,
  defaultSize: { width: 520, height: 320 },
};
