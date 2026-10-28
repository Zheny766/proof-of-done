'use client';

// Milestones table on the home page (AG Grid), with renderers for status, amount and AI confidence. It
// stays live: new deals slide in and a status or payment that changes flashes, so the money moving is visible.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import {
  ClientSideRowModelModule,
  CsvExportModule,
  NumberFilterModule,
  QuickFilterModule,
  TextFilterModule,
  DateFilterModule,
  CellStyleModule,
  RowStyleModule,
  HighlightChangesModule,
  themeQuartz,
  type ColDef,
  type GridApi,
  type ICellRendererParams,
} from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import type { Milestone } from '@/lib/escrow/types';
import { api, fmtMoney, STATUS, StatusBadge } from './status';
import { currentReview, latestFindings } from '@/lib/escrow/policy';

const modules = [ClientSideRowModelModule, TextFilterModule, NumberFilterModule, DateFilterModule, QuickFilterModule, CellStyleModule, RowStyleModule, HighlightChangesModule, CsvExportModule];

const theme = themeQuartz.withParams({
  fontFamily: 'var(--pp-font)',
  accentColor: 'var(--pp-blue)',
  foregroundColor: 'var(--pp-ink)',
  borderColor: 'var(--pp-border)',
  headerFontWeight: 600,
  headerTextColor: 'var(--pp-muted)',
  rowHoverColor: 'var(--pp-highlight)',
  rowHeight: 52,
});

type Row = {
  id: string;
  title: string;
  freelancer: string;
  client: string;
  amount: number;
  currency: string;
  status: Milestone['status'];
  confidence: number | null;
  criteriaMet: string;
  payment: string;
  updated: Date;
  demo: boolean;
};

const PHONE = '(max-width: 639px)';
const subscribePhone = (onChange: () => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

function ConfidenceCell({ value }: ICellRendererParams<Row, number | null>) {
  if (value == null) return <span className="text-pp-muted">-</span>;
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex h-full items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
      <span className="text-xs tabular-nums text-pp-muted">{pct}%</span>
    </div>
  );
}

export function MilestonesGrid({ milestones: initial }: { milestones: Milestone[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const grid = useRef<GridApi<Row> | null>(null);
  const [milestones, setMilestones] = useState(initial);
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) api<{ milestones: Milestone[] }>('/api/escrow/milestones').then((r) => setMilestones(r.milestones), () => {});
    };
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, []);
  const rows = useMemo<Row[]>(
    () =>
      milestones.map((m) => {
        const review = currentReview(m);
        const latest = review ? latestFindings(m.criteria, review.findings) : [];
        const found = latest.filter(Boolean);
        return {
          id: m.id,
          title: m.title,
          freelancer: m.freelancer.name,
          client: m.client.name,
          amount: Number(m.amount),
          currency: m.currency,
          status: m.status,
          confidence: found.length ? Math.min(...found.map((f) => f!.confidence)) : null,
          criteriaMet: review ? `${found.filter((f) => f!.status === 'met').length}/${m.criteria.length}` : `0/${m.criteria.length}`,
          payment: m.payment.captureId ? 'Captured' : m.payment.voidedAt ? 'Voided' : m.payment.authorizationId ? 'On hold' : 'Not funded',
          updated: new Date(m.updatedAt),
          demo: m.description.startsWith('[Demo data]'),
        };
      }),
    [milestones],
  );

  // On a phone only the deal, its status and the amount: nine columns meant scrolling sideways.
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
  const columns = useMemo<ColDef<Row>[]>(
    () => [
      {
        field: 'title', headerName: 'Deal', flex: 2, minWidth: phone ? 120 : 220,
        cellRenderer: ({ data }: ICellRendererParams<Row>) => (
          <span className="font-semibold text-pp-navy">{data?.title}{data?.demo && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-pp-muted">demo</span>}</span>
        ),
      },
      { field: 'status', headerName: 'Status', width: phone ? 132 : 170, enableCellChangeFlash: true, cellRenderer: ({ value }: ICellRendererParams<Row>) => <StatusBadge status={value} /> },
      { field: 'amount', headerName: 'Amount', width: phone ? 88 : 120, type: 'rightAligned', filter: 'agNumberColumnFilter', valueFormatter: ({ value, data }) => (data ? fmtMoney(value, data.currency) : '') },
      { field: 'payment', headerName: 'PayPal', width: 120, enableCellChangeFlash: true, hide: phone },
      { field: 'criteriaMet', headerName: 'Criteria met', width: 120, enableCellChangeFlash: true, hide: phone },
      { field: 'confidence', headerName: 'Lowest AI confidence', width: 180, filter: 'agNumberColumnFilter', cellRenderer: ConfidenceCell, hide: phone },
      { field: 'freelancer', headerName: 'Freelancer', flex: 1, minWidth: 140, hide: phone },
      { field: 'client', headerName: 'Client', flex: 1, minWidth: 140, hide: phone },
      { field: 'updated', headerName: 'Updated', width: 150, filter: 'agDateColumnFilter', sort: 'desc', hide: phone, valueFormatter: ({ value }) => (value ? (value as Date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '') },
    ],
    [phone],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search deals…" aria-label="Search deals" className="h-10 w-full max-w-72 rounded-md border border-pp-border bg-white px-3 text-sm outline-none focus:border-pp-blue" />
        {/* What's shown, as shown: the search, filters and sort apply, every column goes out. */}
        <button
          type="button"
          onClick={() =>
            grid.current?.exportDataAsCsv({
              fileName: 'proof-of-done-deals.csv',
              allColumns: true,
              // The status as people read it ("Changes requested"), dates as ISO.
              processCellCallback: ({ value, column }) => (column.getColId() === 'status' ? STATUS[value as Row['status']]?.label ?? value : value instanceof Date ? value.toISOString() : value),
            })
          }
          className="h-10 shrink-0 rounded-md border border-pp-border bg-white px-3 text-sm font-semibold text-pp-ink hover:border-pp-blue"
        >
          Export CSV
        </button>
      </div>
      <div style={{ height: Math.min(560, Math.max(200, 56 + rows.length * 52 + 2)) }}>
        <AgGridProvider modules={modules}>
          <AgGridReact<Row>
            theme={theme}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ filter: true, sortable: true }}
            quickFilterText={search}
            getRowId={({ data }) => data.id}
            onGridReady={({ api }) => (grid.current = api)}
            onRowClicked={({ data }) => data && router.push(`/m/${data.id}`)}
            onCellKeyDown={({ data, event }) => {
              if (data && (event as KeyboardEvent | null)?.key === 'Enter') router.push(`/m/${data.id}`);
            }}
            rowStyle={{ cursor: 'pointer' }}
            animateRows
            overlayNoRowsTemplate="No deals yet - create one above, or load demo data."
          />
        </AgGridProvider>
      </div>
    </div>
  );
}
