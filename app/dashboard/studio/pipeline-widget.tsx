'use client';

// Custom Studio widget: how much money sits at each escrow stage, left to right. Data comes through
// widgetApi.getData, so dashboard filters apply to it like to the built-in widgets.

/* eslint-disable @typescript-eslint/no-explicit-any -- AG Studio's widget registry types are generic over a custom registry */
import { useEffect, useState } from 'react';
import type { AgWidgetParams } from 'ag-studio';
import { useNarrow } from './use-narrow';

type Stage = { label: string; value: number; count: number };

// The charts' own palette, in the same stage order as the stacked chart and the donut, so a stage has
// one colour across the page.
const TONES = Array.from({ length: 10 }, (_, i) => `var(--pp-chart-${i + 1})`);

// Studio rows are keyed by field; read a field's value by id, falling back to position.
function valueOf(row: Record<string, any>, field: { id: string; key?: string }, index: number) {
  if (field.key && field.key in row) return row[field.key];
  if (field.id in row) return row[field.id];
  const key = Object.keys(row).find((k) => k.includes(field.id));
  return key ? row[key] : Object.values(row)[index];
}

const oneLine = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function EscrowPipelineWidget(props: AgWidgetParams<any>) {
  const { dataMapping, widgetApi, format } = props as any;
  const [stages, setStages] = useState<Stage[]>([]);
  // Clicking a stage filters the rest of the page to it (Studio cross-filter); this widget keeps
  // showing every stage, with the picked one outlined.
  const [picked, setPicked] = useState<string | null>(null);
  // Narrower than a row of stages fits (a phone): the stages go top to bottom instead.
  const [box, narrow] = useNarrow(560);

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
        response = await widgetApi.getData({ fields: [stage, amount, countField] }, { crossFilter: 'none' });
      } catch {
        response = await widgetApi.getData({ fields: [stage, amount] }, { crossFilter: 'none' });
      }
      if (!active) return;
      const rows: Record<string, any>[] = response?.results?.rows ?? [];
      const countOf = (r: Record<string, any>) => Number(r[countField.key] ?? 0);
      const parsed = rows
        .map((r) => ({ label: String(valueOf(r, stage, 0) ?? '(blank)'), value: Number(valueOf(r, amount, 1) ?? 0), count: countOf(r) }))
        .filter((s) => s.label !== '(blank)' && s.label !== 'null' && s.value > 0)
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
    <div ref={box} style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', height: '100%', alignItems: 'stretch', gap: 6, padding: '8px 4px', fontFamily: 'var(--pp-font)', overflowY: narrow ? 'auto' : undefined }}>
      {stages.map((s, i) => {
        const color = TONES[i % TONES.length];
        const pct = Math.round((s.value / total) * 100);
        const label = s.label.replace(/^\d+\s*·\s*/, '');
        const on = picked === s.label;
        return (
          <button
            type="button"
            key={s.label}
            title={`${label}: ${money(s.value)}. Click to filter the page to this stage`}
            aria-pressed={on}
            onClick={() => {
              widgetApi.toggleCrossFilter({ type: 'value', field: dataMapping.stage[0], value: s.label, group: 0 });
              setPicked(on ? null : s.label);
            }}
            style={{
              cursor: 'pointer',
              textAlign: 'left',
              font: 'inherit',
              border: 'none',
              outline: on ? `2px solid ${color}` : 'none',
              outlineOffset: -2,
              opacity: picked && !on ? 0.55 : 1,
              flex: narrow ? 'none' : Math.max(1, s.value / total) * 4 + 1,
              minWidth: narrow ? 0 : 92,
              position: 'relative',
              background: `color-mix(in srgb, ${color} 8%, transparent)`,
              ...(narrow ? { borderLeft: `4px solid ${color}` } : { borderTop: `4px solid ${color}` }),
              borderRadius: 10,
              padding: narrow ? '8px 12px' : '10px 12px',
              display: 'flex',
              flexDirection: narrow ? 'row' : 'column',
              alignItems: narrow ? 'center' : undefined,
              justifyContent: 'space-between',
              gap: narrow ? 8 : undefined,
            }}
          >
            {/* Darkened, so light palette colours (amber, sky) still read as text. */}
            <div style={{ ...oneLine, fontSize: 11, fontWeight: 700, color: `color-mix(in srgb, ${color} 65%, black)`, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
            <div style={narrow ? { textAlign: 'right', minWidth: 0 } : undefined}>
              <div style={{ fontSize: narrow ? 17 : 20, fontWeight: 700, color: 'var(--pp-ink)' }}>{money(s.value)}</div>
              <div style={{ ...oneLine, fontSize: 11, color: 'var(--pp-muted)' }}>
                {pct}% of escrow{showCounts && s.count ? ` · ${s.count} deal${s.count === 1 ? '' : 's'}` : ''}
              </div>
            </div>
            {!narrow && i < stages.length - 1 && (
              <span aria-hidden style={{ position: 'absolute', right: -11, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: 'var(--pp-muted)' }}>›</span>
            )}
          </button>
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
    stage: { type: 'field', supportedRoles: ['category'], requires: { cardinality: 'one' }, required: true, aiDescription: 'The escrow stage of each deal' },
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
