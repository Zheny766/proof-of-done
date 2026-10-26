// The built-in "Escrow overview" report: pages for the money on hold, the AI reviewer and freelancers,
// as AG Studio report state. Field ids ('milestones.released') refer to the data sources in ./data.ts.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';

// Position on the canvas grid, in tracks: 24 columns wide, rows of studioCanvasRowHeight.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({
  xTrack,
  yTrack,
  xSpan,
  ySpan,
});
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const avg = (id: string) => ({ id, aggregation: 'avg' as const });
const countd = (id: string) => ({ id, aggregation: 'countd' as const });

// Same stack as --pp-font in app/globals.css.
const PAYPAL_FONT = '"PayPal Open", "Helvetica Neue", Helvetica, Arial, sans-serif';

const typography = (fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => ({
  fontFamily: PAYPAL_FONT,
  fontSize,
  fontWeight,
  fontStyle: 'normal' as const,
});

// A KPI tile, styled the same everywhere: bold title, large value, optional sparkline along `sparklineX`.
const kpi = (text: string, value: { id: string; aggregation?: 'sum' | 'avg' | 'countd' }, sparklineX?: string) => ({
  type: 'value' as const,
  dataMapping: {
    value: [value],
    ...(sparklineX && { sparklineX: [{ id: sparklineX }] }),
  },
  format: {
    title: { enabled: true, text, typography: typography(14, 'bold') },
    caption: { enabled: true, text: '', typography: typography(0) },
    style: { typography: typography(22) },
  },
});

const legend = { theme: { common: { legend: { enabled: true } } } };

const overview: AgPageState = {
  id: 'overview',
  widgets: {
    'created-date': {
      type: 'date-filter',
      dataMapping: { value: [{ id: 'milestones.createdDate' }] },
      format: { style: { filterType: 'relative' } },
    },
    'kpi-on-hold': kpi('On hold', sum('milestones.onHold')),
    'kpi-released': kpi('Released', sum('milestones.released'), 'calendar::week'),
    'kpi-milestones': kpi('Milestones', countd('milestones.id'), 'calendar::week'),
    'kpi-hours': kpi('Hours to paid', avg('milestones.hoursToPaid')),
    // Custom widget (./pipeline-widget.tsx): the escrow lifecycle as a pipeline.
    pipeline: {
      type: 'escrow-pipeline',
      dataMapping: { stage: [{ id: 'milestones.stage' }], amount: [sum('milestones.amount')] },
      format: title('Escrow pipeline: where every dollar is right now'),
    } as unknown as NonNullable<AgPageState['widgets']>[string],
    'value-by-week': {
      type: 'column-chart-stacked',
      dataMapping: {
        categoryKey: [{ id: 'milestones.createdDate::week' }],
        valueKey: [sum('milestones.amount')],
        legendKey: [{ id: 'milestones.stage' }],
      },
      format: { ...title('Escrowed value by week, by stage'), style: legend },
    },
    'auto-release': {
      type: 'radial-gauge',
      dataMapping: { value: [{ id: 'autoReleaseRate' }] },
      format: {
        ...title('Paid without the client stepping in'),
        style: {
          scaleLabel: { min: 0, max: 1 },
          label: { typography: typography(24, 'bold') },
          secondaryLabel: { enabled: true, text: 'AI auto-release rate', typography: typography(12) },
        },
      },
    },
    'stage-donut': {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'milestones.stage' }], valueKey: [sum('milestones.amount')] },
      format: { ...title('Where the money is'), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } },
    },
    'category-treemap': {
      type: 'treemap-chart',
      dataMapping: { categoryKey: [{ id: 'milestones.category' }, { id: 'milestones.title' }], valueKey: [sum('milestones.amount')] },
      format: title('Escrowed value by type of work'),
    },
    'milestone-grid': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'milestones.title' },
          { id: 'milestones.stage' },
          { id: 'milestones.freelancer' },
          { id: 'milestones.client' },
          sum('milestones.amount'),
          { id: 'milestones.lowestConfidence', aggregation: 'min' },
          { id: 'milestones.hoursToPaid', aggregation: 'max' },
          { id: 'milestones.createdAt' },
        ],
      },
      sort: [{ field: { id: 'milestones.createdAt' }, direction: 'desc' }],
      format: title('All milestones'),
    },
  },
  widgetLayout: {
    'kpi-on-hold': at(0, 0, 4, 7),
    'kpi-released': at(4, 0, 4, 7),
    'kpi-milestones': at(8, 0, 4, 7),
    'kpi-hours': at(12, 0, 4, 7),
    'created-date': at(16, 0, 8, 7),
    pipeline: at(0, 7, 24, 9),
    'value-by-week': at(0, 16, 16, 17),
    'auto-release': at(16, 16, 8, 17),
    'stage-donut': at(0, 33, 10, 18),
    'category-treemap': at(10, 33, 14, 18),
    'milestone-grid': at(0, 51, 24, 20),
  },
};

const reviewer: AgPageState = {
  id: 'reviewer',
  widgets: {
    'kpi-reviews': kpi('AI reviews', countd('reviews.id'), 'calendar::week'),
    'kpi-confidence': kpi('Avg confidence', avg('findings.confidence')),
    'kpi-seconds': kpi('Review time (s)', avg('reviews.durationSec')),
    'kpi-tokens': kpi('Output tokens', sum('reviews.outputTokens')),
    decisions: {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'reviews.decision' }], valueKey: [countd('reviews.id')] },
      format: { ...title('What the reviewer decided'), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } },
    },
    'verdicts-by-category': {
      type: 'column-chart-stacked',
      dataMapping: {
        categoryKey: [{ id: 'milestones.category' }],
        valueKey: [countd('findings.id')],
        legendKey: [{ id: 'findings.status' }],
      },
      format: { ...title('Criterion verdicts by type of work'), style: legend },
    },
    'confidence-pivot': {
      type: 'pivot-grid',
      dataMapping: {
        rows: [{ id: 'milestones.category' }],
        columns: [{ id: 'findings.status' }],
        values: [avg('findings.confidence')],
      },
      format: { ...title('Average confidence by verdict'), style: { grandTotalRow: { enabled: true } } },
    },
    'weakest-findings': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'milestones.title' },
          { id: 'findings.criterion' },
          { id: 'findings.status' },
          { id: 'findings.confidence', aggregation: 'min' },
          { id: 'findings.evidence' },
        ],
      },
      sort: [{ field: { id: 'findings.confidence', aggregation: 'min' }, direction: 'asc' }],
      format: title('Least confident verdicts first: where a human should look'),
    },
  },
  widgetLayout: {
    'kpi-reviews': at(0, 0, 6, 7),
    'kpi-confidence': at(6, 0, 6, 7),
    'kpi-seconds': at(12, 0, 6, 7),
    'kpi-tokens': at(18, 0, 6, 7),
    decisions: at(0, 7, 8, 18),
    'verdicts-by-category': at(8, 7, 16, 18),
    'confidence-pivot': at(0, 25, 8, 20),
    'weakest-findings': at(8, 25, 16, 20),
  },
};

const freelancers: AgPageState = {
  id: 'freelancers',
  widgets: {
    'kpi-freelancers': kpi('Freelancers', countd('milestones.freelancer')),
    'kpi-clients': kpi('Clients', countd('milestones.client')),
    'kpi-release-rate': kpi('Release rate', { id: 'releaseRate' }),
    'kpi-hold-share': kpi('Share on hold', { id: 'holdShare' }),
    'paid-by-freelancer': {
      type: 'bar-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'milestones.freelancer' }],
        valueKey: [sum('milestones.released'), sum('milestones.onHold')],
      },
      format: { ...title('Released vs on hold, by freelancer'), style: { theme: { common: { legend: { enabled: true, position: 'right' } } } } },
    },
    'stage-pivot': {
      type: 'pivot-grid',
      dataMapping: {
        rows: [{ id: 'milestones.freelancer' }],
        columns: [{ id: 'milestones.stage' }],
        values: [sum('milestones.amount')],
      },
      format: { style: { totalColumns: true, totalColumnsPlacement: 'before', grandTotalRow: { enabled: true } } },
    },
    'client-sunburst': {
      type: 'sunburst-chart',
      dataMapping: { categoryKey: [{ id: 'milestones.client' }, { id: 'milestones.freelancer' }], valueKey: [sum('milestones.amount')] },
      format: title('Who pays whom'),
    },
  },
  widgetLayout: {
    'kpi-freelancers': at(0, 0, 6, 7),
    'kpi-clients': at(6, 0, 6, 7),
    'kpi-release-rate': at(12, 0, 6, 7),
    'kpi-hold-share': at(18, 0, 6, 7),
    'paid-by-freelancer': at(0, 7, 14, 20),
    'client-sunburst': at(14, 7, 10, 20),
    'stage-pivot': at(0, 27, 24, 20),
  },
};

// The report opens on its first page.
export const dashboardReport: AgReportState = {
  selectedPageId: overview.id,
  pages: [overview, reviewer, freelancers],
};
