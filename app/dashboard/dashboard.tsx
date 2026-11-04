'use client';

// The dashboard: the PayPal shell (./components) wrapped around a single AG Studio instance, which
// this file renders. Studio's configuration (data sources, theme, default report, AI) lives in
// ./studio. The shell owns saved reports, page names and navigation; Studio owns
// the report being edited. They meet in two places:
//   - the shell drives Studio through its AgStudioApi (setState, getState, undo, redo)
//   - Studio reports every change back through onStateUpdated, which only redraws the shell
//
// Nothing tracks edits as they happen. Save reads the report from Studio with getState(), and
// leaving a report compares Studio's state with the saved one there and then.

import './english-numbers'; // first: before ag-studio builds its number formatters
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AgStudioAiModule,
  enableStudioDevValidations,
  type AgReportState,
  type AgStudioApi,
  type AgStudioMode,
} from 'ag-studio';
import { AgStudio, AgStudioProvider, createWidgets } from 'ag-studio-react';
import type { EscrowDashboardData } from '@/lib/escrow/analytics';
import { AppShell } from './components/app-shell';
import {
  CreateReportDialog,
  DeleteReportDialog,
  ResetDemoDialog,
  UnsavedChangesDialog,
  type DashboardDialog,
} from './components/dialogs';
import { EmptyData } from './components/empty-data';
import { ReportHeader } from './components/report-header';
import {
  blankReport,
  copyOf,
  defaultReport,
  findReport,
  initialReports,
  newId,
  remove,
  upsert,
  type SavedReport,
} from './reports-store';
import { pagesFor, pageTitlesFor } from './page-titles';
import { ReportsSidebar } from './components/sidebar';
import { DashboardSkeleton } from './components/skeleton';
import * as reportState from './report-state';
import { buildAi } from './studio/ai';
import { buildStudioData, hasData } from './studio/data';
import { agStudioPayPalTheme } from './studio/theme';
import { escrowPipelineWidget } from './studio/pipeline-widget';
import { holdsWidget, moneyFlowWidget, releaseGateWidget } from './studio/escrow-widgets';
import { useReports } from './use-reports';
import { dealFacts } from '@/app/components/deal-facts';
import { WebMcpTools, type WebMcpTool } from '@/app/components/webmcp';

if (process.env.NODE_ENV !== 'production') {
  enableStudioDevValidations();
}

type DashboardProps = {
  data: EscrowDashboardData;
  licenseKey?: string;
  /** Claude models the assistant may use; omitted when no key is configured, which hides the assistant. */
  aiModels?: string[];
};

type StudioHistory = { canUndo: boolean; canRedo: boolean };

const NO_HISTORY: StudioHistory = { canUndo: false, canRedo: false };

const noSubscription = () => () => {};

// An empty pivot cell (no deal in that stage for that freelancer) read "N/A", like an error.
const LOCALE_TEXT = { valueNotApplicable: '—' };

// On a phone Studio squeezed the 24-column page into the screen: KPI values turned into "...". There
// it keeps a desktop-like width and scrolls sideways inside its box instead.
const PHONE = '(max-width: 767px)';
const LAYOUT = { widgetBorderEnabled: true };
// Editing on a phone keeps the desktop layout, scrolling sideways; reading gets the phone layout (reportState.forPhone).
const PHONE_LAYOUT = { widgetBorderEnabled: true, minWidth: 980 };
const PHONE_VIEW_LAYOUT = { widgetBorderEnabled: true, minWidth: 0 };
const onPhone = () => window.matchMedia(PHONE).matches;
/** The state Studio shows in `mode`: on a phone in view mode, laid out for a narrow screen. */
const forScreen = (mode: AgStudioMode, state: AgReportState) => (mode === 'view' && onPhone() ? reportState.forPhone(state) : state);
// On a phone the filters rail would eat a fifth of the width; the pipeline's buttons filter the page instead.
const PHONE_PANELS = { view: { right: [] }, edit: { right: ['edit', 'data', 'ai'] as ('edit' | 'data' | 'ai')[] } };
const subscribePhone = (onChange: () => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

export function Dashboard(props: DashboardProps) {
  // Saved reports live in localStorage, which only exists in the browser.
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return inBrowser ? <ReportsDashboard {...props} /> : <DashboardSkeleton />;
}

function ReportsDashboard({ data, licenseKey, aiModels }: DashboardProps) {
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
  const { store, latest, update, editReport } = useReports();
  const apiRef = useRef<AgStudioApi | null>(null);

  // The open report as it is in Studio now, unsaved edits included, for drawing the shell.
  // Null until Studio is ready.
  const [studioState, setStudioState] = useState<AgReportState | null>(null);
  const [history, setHistory] = useState<StudioHistory>(NO_HISTORY);
  const [mode, setMode] = useState<AgStudioMode>('view');
  const [dialog, setDialog] = useState<DashboardDialog>(null);

  const { reports } = store;
  // The open report, as it was last saved.
  const saved = findReport(reports, store.activeId) ?? reports[0];
  // Studio reads initialState once, when it is created, and starts on the open report; after that,
  // its state is read from Studio.
  const [initialState] = useState(() => reportState.withFiltersPanelFor('view', forScreen('view', saved.state)));
  const state = studioState ?? initialState;
  const studioData = useMemo(() => buildStudioData(data), [data]);
  // Studio's built-in widgets plus our custom escrow pipeline widget.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom widget types live outside the default registry
  const widgets = useMemo(() => createWidgets({ additionalTypes: [escrowPipelineWidget, moneyFlowWidget, releaseGateWidget, holdsWidget] } as any), []);
  // `ai` is read once, when Studio is created.
  const ai = useMemo(() => (aiModels?.length ? buildAi(aiModels) : undefined), [aiModels]);
  const agentTools = useMemo(() => webMcpTools(data), [data]);

  const load = (
    report: SavedReport,
    selectedPageId = report.state.selectedPageId,
    nextMode = mode,
  ) => {
    const api = apiRef.current;
    if (!api) return;
    api.setState(
      reportState.withFiltersPanelFor(
        nextMode,
        forScreen(nextMode, {
          ...report.state,
          selectedPageId,
        }),
      ),
    );
    // Undo shouldn't step back into the previous report.
    api.clearHistory();
    setStudioState(api.getState());
    setHistory(NO_HISTORY);
    setMode(nextMode);
    update((current) => ({ ...current, activeId: report.id }));
  };
  const updateState = (next: (current: AgReportState) => AgReportState) => {
    const api = apiRef.current;
    if (api) api.setState(next(api.getState()));
  };
  const changeMode = (next: AgStudioMode) => {
    // On a phone, editing starts from the report's own layout and reading goes back to the phone one.
    updateState((s) => reportState.withFiltersPanelFor(next, onPhone() ? forScreen(next, reportState.withLayoutOf(s, saved.state)) : s));
    setMode(next);
  };

  const save = () => {
    const api = apiRef.current;
    if (!api) return;
    const current = api.getState();
    editReport(saved.id, (report) => ({
      ...report,
      // Titles for exactly the pages being saved.
      pageTitles: pageTitlesFor({ pageTitles: report.pageTitles, state: current }),
      state: current,
      updatedAt: new Date().toISOString(),
    }));
  };
  const discard = () =>
    load(saved, reportState.pageToSelect(saved.state, state.selectedPageId));
  // Anything that leaves the current report or edit mode asks first when it has unsaved changes.
  const guard = (then: () => void) => {
    const api = apiRef.current;
    if (api && reportState.hasChanges(api.getState(), forScreen(mode, saved.state))) {
      setDialog({ kind: 'unsaved', then });
    } else then();
  };

  const openReport = (id: string) => {
    const report = findReport(reports, id);
    if (report && id !== saved.id) guard(() => load(report));
  };
  const createReport = (name: string) => {
    const report = blankReport(name);
    update((current) => upsert(current, report));
    load(report, report.state.selectedPageId, 'edit');
  };
  const duplicateReport = (id: string) =>
    guard(() => {
      const source = findReport(reports, id);
      if (!source) return;
      const copy = copyOf(source);
      update((current) => upsert(current, copy));
      load(copy);
    });
  const resetDemo = () => {
    update(initialReports);
    load(defaultReport(), undefined, 'view');
  };
  const deleteReport = (report: SavedReport) => {
    update((current) => remove(current, report.id));
    if (report.id !== saved.id) return;
    const { reports: next, activeId } = latest();
    load(findReport(next, activeId) ?? next[0]);
  };
  const renameReport = (id: string, name: string) =>
    editReport(id, (report) => ({ ...report, name }));

  // Studio leaves page navigation to the host, and its state has no page names. Page names are
  // saved as soon as they change; new pages are numbered until they're named.
  const selectPage = (id: string, pageId: string) => {
    if (id === saved.id) updateState((s) => reportState.withFiltersPanelFor(mode, reportState.selectPage(s, pageId)));
    else {
      const report = findReport(reports, id);
      if (report) guard(() => load(report, pageId));
    }
  };
  const addPage = () => {
    const id = newId('page');
    updateState((s) => reportState.addPage(s, id));
    // A new page is empty, so open edit mode to fill it.
    if (mode !== 'edit') changeMode('edit');
    return id;
  };
  const removePage = (id: string) =>
    updateState((s) => reportState.removePage(s, id));
  const renamePage = (id: string, title: string) =>
    editReport(saved.id, (report) => ({
      ...report,
      pageTitles: { ...report.pageTitles, [id]: title },
    }));

  const editing = mode === 'edit';
  const pages = pagesFor({ pageTitles: saved.pageTitles, state });

  return (
    <AppShell
      sidebar={
        <ReportsSidebar
          reports={reports}
          activeId={saved.id}
          activePages={pages}
          selectedPageId={state.selectedPageId}
          editing={editing}
          ready={studioState !== null}
          onSelectReport={openReport}
          onSelectPage={selectPage}
          onAddPage={() => (apiRef.current ? addPage() : undefined)}
          onRemovePage={removePage}
          onRenamePage={renamePage}
          onRenameReport={renameReport}
          onCreate={() => guard(() => setDialog({ kind: 'create' }))}
          onDuplicate={duplicateReport}
          onDelete={(id) => {
            const report = findReport(reports, id);
            if (report) setDialog({ kind: 'delete', report });
          }}
          onReset={() => setDialog({ kind: 'reset' })}
        />
      }
    >
      <ReportHeader
        reportName={saved.name}
        pageTitle={pages.find((p) => p.id === state.selectedPageId)?.title}
        asOf={data.asOf}
        paymentMode={data.paymentMode}
        demoDeals={data.milestones.filter((m) => m.isDemo).length}
        deals={data.milestones.length}
        editing={editing}
        pageIsEmpty={studioState !== null && !reportState.pageHasWidgets(state)}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={() => apiRef.current?.undo()}
        onRedo={() => apiRef.current?.redo()}
        onSave={save}
        onDiscard={discard}
        onEditingChange={(next) =>
          next ? changeMode('edit') : guard(() => changeMode('view'))
        }
      />

      <WebMcpTools tools={agentTools} />
      {/* Editing on a phone keeps the desktop layout, which scrolls inside this box instead of widening the page. */}
      <div className="min-h-0 flex-1 overflow-x-auto">
        {hasData(data) ? (
          <AgStudioProvider licenseKey={licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
            <AgStudio
              style={{ height: '100%', width: '100%' }}
              theme={agStudioPayPalTheme}
              layout={phone ? (mode === 'view' ? PHONE_VIEW_LAYOUT : PHONE_LAYOUT) : LAYOUT}
              {...(phone && { panels: PHONE_PANELS })}
              localeText={LOCALE_TEXT}
              data={studioData}
              widgets={widgets}
              ai={ai}
              initialState={initialState}
              mode={mode}
              onApiReady={(event) => {
                apiRef.current = event.api;
              }}
              onStudioReady={(event) => setStudioState(event.api.getState())}
              onStateUpdated={(event) => {
                const { undo, redo } = event.api.getHistory();
                setStudioState(event.state);
                setHistory({ canUndo: undo.length > 0, canRedo: redo.length > 0 });
              }}
            />
          </AgStudioProvider>
        ) : (
          <EmptyData />
        )}
      </div>

      <UnsavedChangesDialog
        open={dialog?.kind === 'unsaved'}
        reportName={saved.name}
        onCancel={() => setDialog(null)}
        onDiscard={() => {
          discard();
          if (dialog?.kind === 'unsaved') dialog.then();
          setDialog(null);
        }}
        onSave={() => {
          save();
          if (dialog?.kind === 'unsaved') dialog.then();
          setDialog(null);
        }}
      />
      <CreateReportDialog
        open={dialog?.kind === 'create'}
        onClose={() => setDialog(null)}
        onCreate={(name) => {
          setDialog(null);
          createReport(name);
        }}
      />
      <DeleteReportDialog
        report={dialog?.kind === 'delete' ? dialog.report : null}
        onCancel={() => setDialog(null)}
        onConfirm={(report) => {
          deleteReport(report);
          setDialog(null);
        }}
      />
      <ResetDemoDialog
        open={dialog?.kind === 'reset'}
        builtInName={defaultReport().name}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          resetDemo();
          setDialog(null);
        }}
      />
    </AppShell>
  );
}

// Read-only tools for AI agents in the browser (WebMCP): the same numbers the dashboard shows.
function webMcpTools(data: EscrowDashboardData): WebMcpTool[] {
  const usd = (n: number) => `$${n.toFixed(2)}`;
  return [
    {
      name: 'escrow_summary',
      description: 'Totals for the Proof of Done escrow: money on hold at PayPal, money paid out, deals per stage, and how often the AI paid out without the client stepping in.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const rows = data.milestones;
        const byStage = new Map<string, number>();
        rows.forEach((r) => byStage.set(r.stage, (byStage.get(r.stage) ?? 0) + 1));
        const released = rows.filter((r) => r.isReleased);
        return [
          `On hold at PayPal: ${usd(rows.reduce((s, r) => s + r.onHold, 0))} across ${rows.filter((r) => r.onHold > 0).length} deals.`,
          `Paid out: ${usd(rows.reduce((s, r) => s + r.released, 0))} across ${released.length} deals; ${released.filter((r) => r.autoReleased).length} of them paid by the AI without the client stepping in.`,
          `Deals per stage: ${[...byStage].map(([k, v]) => `${k}: ${v}`).join(', ')}.`,
          `Payments: ${data.paymentMode === 'sandbox' ? 'PayPal sandbox' : 'simulated'}; ${rows.filter((r) => r.isDemo).length} of ${rows.length} deals are labelled demo data.`,
        ].join('\n');
      },
    },
    {
      name: 'stuck_deals',
      description: 'Deals whose money has been on hold longer than a number of hours, longest first.',
      inputSchema: { type: 'object', properties: { minHours: { type: 'number', description: 'Only deals on hold at least this long (default 72)' } } },
      execute: async (args) => {
        const min = typeof args.minHours === 'number' ? args.minHours : 72;
        const now = Date.parse(data.asOf);
        const stuck = data.milestones
          .filter((r) => r.onHold > 0 && r.fundedAt)
          .map((r) => ({ r, hours: Math.round((now - Date.parse(r.fundedAt!)) / 3_600_000) }))
          .filter((x) => x.hours >= min)
          .sort((a, b) => b.hours - a.hours);
        return stuck.length
          ? stuck.map(({ r, hours }) => `${r.id} · ${r.title} · ${r.stage} · ${usd(r.amount)} · on hold ${hours} h`).join('\n')
          : `No deal has been on hold for ${min} hours or more.`;
      },
    },
    {
      name: 'explain_deal',
      description: 'Why one deal was paid, held, escalated or sent back: the AI verdict on each criterion, the second opinion, the PayPal state and the latest events.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Milestone id, like ms_1a2b3c4d5e6f' } }, required: ['id'] },
      execute: async (args) => dealFacts(String(args.id ?? '')),
    },
  ];
}
