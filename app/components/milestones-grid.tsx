'use client';

// Milestones table on the home page (AG Grid), with renderers for status, amount and AI confidence.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ClientSideRowModelModule,
  NumberFilterModule,
  QuickFilterModule,
  TextFilterModule,
  DateFilterModule,
  CellStyleModule,
  RowStyleModule,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import type { Milestone } from '@/lib/escrow/types';
import { fmtMoney, StatusBadge } from './status';
import { latestFindings } from '@/lib/escrow/policy';

const modules = [ClientSideRowModelModule, TextFilterModule, NumberFilterModule, DateFilterModule, QuickFilterModule, CellStyleModule, RowStyleModule];

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

export function MilestonesGrid({ milestones }: { milestones: Milestone[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const rows = useMemo<Row[]>(
    () =>
      milestones.map((m) => {
        const review = m.reviews.at(-1);
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

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      {
        field: 'title', headerName: 'Milestone', flex: 2, minWidth: 220,
        cellRenderer: ({ data }: ICellRendererParams<Row>) => (
          <span className="font-semibold text-pp-navy">{data?.title}{data?.demo && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-pp-muted">demo</span>}</span>
        ),
      },
      { field: 'status', headerName: 'Status', width: 170, cellRenderer: ({ value }: ICellRendererParams<Row>) => <StatusBadge status={value} /> },
      { field: 'amount', headerName: 'Amount', width: 120, type: 'rightAligned', filter: 'agNumberColumnFilter', valueFormatter: ({ value, data }) => (data ? fmtMoney(value, data.currency) : '') },
      { field: 'payment', headerName: 'PayPal', width: 120 },
      { field: 'criteriaMet', headerName: 'Criteria met', width: 120 },
      { field: 'confidence', headerName: 'Lowest AI confidence', width: 180, filter: 'agNumberColumnFilter', cellRenderer: ConfidenceCell },
      { field: 'freelancer', headerName: 'Freelancer', flex: 1, minWidth: 140 },
      { field: 'client', headerName: 'Client', flex: 1, minWidth: 140 },
      { field: 'updated', headerName: 'Updated', width: 150, filter: 'agDateColumnFilter', sort: 'desc', valueFormatter: ({ value }) => (value ? (value as Date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '') },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-3">
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search milestones…" aria-label="Search milestones" className="h-10 w-72 rounded-md border border-pp-border bg-white px-3 text-sm outline-none focus:border-pp-blue" />
      <div style={{ height: Math.min(560, 56 + rows.length * 52 + 2) }}>
        <AgGridProvider modules={modules}>
          <AgGridReact<Row>
            theme={theme}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ filter: true, sortable: true }}
            quickFilterText={search}
            getRowId={({ data }) => data.id}
            onRowClicked={({ data }) => data && router.push(`/m/${data.id}`)}
            rowStyle={{ cursor: 'pointer' }}
            overlayNoRowsTemplate="No milestones yet - create one above, or load demo data."
          />
        </AgGridProvider>
      </div>
    </div>
  );
}
