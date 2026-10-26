'use client';

// Custom Studio widget: how much money sits at each escrow stage, left to right. Data comes through
// widgetApi.getData, so dashboard filters apply to it like to the built-in widgets.

/* eslint-disable @typescript-eslint/no-explicit-any -- AG Studio's widget registry types are generic over a custom registry */
import { useEffect, useState } from 'react';
import type { AgWidgetParams } from 'ag-studio';

type Stage = { label: string; value: number; count: number };

const TONES = ['#94a3b8', '#0070e0', '#7b61ff', '#f5a623', '#00875a', '#001c64'];

// Studio rows are keyed by field; read a field's value by id, falling back to position.
function valueOf(row: Record<string, any>, field: { id: string; key?: string }, index: number) {
  if (field.key && field.key in row) return row[field.key];
  if (field.id in row) return row[field.id];
  const key = Object.keys(row).find((k) => k.includes(field.id));
  return key ? row[key] : Object.values(row)[index];
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function EscrowPipelineWidget(props: AgWidgetParams<any>) {
  const { dataMapping, widgetApi, format } = props as any;
  const [stages, setStages] = useState<Stage[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const stage = dataMapping?.stage?.[0];
      const amount = dataMapping?.amount?.[0];
      if (!stage || !amount) {
        widgetApi.setDisplayState('incompleteDataMapping');
        return;
      }
      widgetApi.setDisplayState('loading');
      // Rows are keyed by each field's key ("<field>.<aggregation>"); a count of the mapped measure
      // gives the number of milestones per stage. Older layouts without it still render.
      const countField = { ...amount, key: `${amount.fieldId ?? amount.id}.count`, aggregation: 'count', format: undefined };
      let response: any;
      try {
        response = await widgetApi.getData({ fields: [stage, amount, countField] });
      } catch {
        response = await widgetApi.getData({ fields: [stage, amount] });
      }
      if (!active) return;
      const rows: Record<string, any>[] = response?.results?.rows ?? [];
      const countOf = (r: Record<string, any>) => Number(r[countField.key] ?? 0);
      const parsed = rows
        .map((r) => ({ label: String(valueOf(r, stage, 0) ?? '(blank)'), value: Number(valueOf(r, amount, 1) ?? 0), count: countOf(r) }))
        .filter((s) => s.label !== '(blank)' && s.label !== 'null')
        .sort((a, b) => a.label.localeCompare(b.label));
      if (parsed.length === 0) {
        widgetApi.setDisplayState('noData');
        return;
      }
      setStages(parsed);
      widgetApi.setDisplayState('displayed');
    })().catch((error) => {
      console.warn('[escrow-pipeline]', error);
      if (active) widgetApi.setDisplayState('noData');
    });
    return () => {
      active = false;
    };
  }, [dataMapping, widgetApi]);

  const total = stages.reduce((s, x) => s + x.value, 0) || 1;
  const showCounts = format?.style?.showCounts !== false;

  return (
    <div style={{ display: 'flex', height: '100%', alignItems: 'stretch', gap: 6, padding: '8px 4px', fontFamily: 'var(--pp-font)' }}>
      {stages.map((s, i) => {
        const color = TONES[i % TONES.length];
        const pct = Math.round((s.value / total) * 100);
        const label = s.label.replace(/^\d+\s*·\s*/, '');
        return (
          <div
            key={s.label}
            title={`${label}: ${money(s.value)}`}
            style={{
              flex: Math.max(1, s.value / total) * 4 + 1,
              minWidth: 92,
              position: 'relative',
              background: `${color}14`,
              borderTop: `4px solid ${color}`,
              borderRadius: 10,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--pp-ink)' }}>{money(s.value)}</div>
              <div style={{ fontSize: 12, color: 'var(--pp-muted)' }}>
                {pct}% of escrow{showCounts && s.count ? ` · ${s.count} milestone${s.count === 1 ? '' : 's'}` : ''}
              </div>
            </div>
            {i < stages.length - 1 && (
              <span aria-hidden style={{ position: 'absolute', right: -11, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: 'var(--pp-muted)' }}>›</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const escrowPipelineWidget: any = {
  id: 'escrow-pipeline',
  label: 'Escrow pipeline',
  icon: { url: '/icon.svg' },
  dataMapping: {
    stage: { type: 'field', supportedRoles: ['category'], requires: { cardinality: 'one' }, required: true, aiDescription: 'The escrow stage of each milestone' },
    amount: { type: 'field', supportedRoles: ['numeric'], requires: { cardinality: 'one' }, required: true, aiDescription: 'The money at each stage' },
  },
  form: (params: any) =>
    params.createDefaults({
      dataMappingItems: [
        { key: 'stage', label: 'Stage' },
        { key: 'amount', label: 'Amount' },
      ],
    }),
  comp: EscrowPipelineWidget,
  defaultSize: { width: 900, height: 160 },
  minSize: { width: 400, height: 120 },
  ai: { description: 'Shows how much escrowed money sits at each stage of the escrow lifecycle, as a left-to-right pipeline.' },
};
