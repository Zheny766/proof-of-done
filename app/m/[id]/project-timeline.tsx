'use client';

// A project's stages on a Bryntum Gantt: the plan (each stage's planned days, one after the other)
// drawn as a baseline under what happened (PayPal hold, delivery, payment), with the dependency
// between stages and today's line. Read-only: the deal page is where people act.

import { useMemo, useSyncExternalStore } from 'react';
import { BryntumGantt } from '@bryntum/gantt-react';
import { TaskModel, type GridColumnConfig, type TaskModelConfig } from '@bryntum/gantt';
import '@bryntum/gantt/gantt.css';
import '@bryntum/gantt/svalbard-light.css';
import '@bryntum/gantt/fontawesome/css/fontawesome.css';
import '@bryntum/gantt/fontawesome/css/solid.css';
import type { StageSummary } from '@/lib/escrow/service';
import { fmtMoney } from '@/app/components/status';

// A getter, not `static fields = [...]`: the production build compiles class fields to assignments,
// and Bryntum's base class defines `fields` as a getter only.
class StageTask extends TaskModel {
  static override get fields() {
    return [{ name: 'amount' }, { name: 'state' }];
  }
}

const DAY = 86_400_000;
const day = (iso: string) => new Date(new Date(iso).setUTCHours(0, 0, 0, 0));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

const STATE: Record<StageSummary['status'], [string, string]> = {
  awaiting_funding: ['Not funded yet', 'gray'],
  funded: ['In work', 'blue'],
  reviewing: ['AI reviewing', 'violet'],
  changes_requested: ['Fix asked', 'amber'],
  escalated: ['Client decides', 'orange'],
  verified: ['Verified', 'teal'],
  released: ['Paid', 'green'],
  cancelled: ['Cancelled', 'red'],
};
const DONE: Record<StageSummary['status'], number> = { awaiting_funding: 0, funded: 30, reviewing: 70, changes_requested: 60, escalated: 80, verified: 90, released: 100, cancelled: 0 };

/** The Gantt's rows: each stage's plan as a baseline, what happened as the bar and its marks. */
function timeline(stages: StageSummary[], currency: string) {
  const today = day(new Date().toISOString());
  let planned = day(stages[0].createdAt);
  let latest = today;
  const tasks = stages.map((s) => {
    const plannedStart = planned;
    const plannedEnd = addDays(plannedStart, s.days);
    planned = plannedEnd;
    // What happened: from the PayPal hold to the payment; a stage not funded yet sits on the plan.
    const actualStart = s.fundedAt ? day(s.fundedAt) : plannedStart;
    const closed = s.paidAt ?? s.cancelledAt;
    const actualEnd = closed ? addDays(day(closed), 1) : s.fundedAt ? new Date(Math.max(plannedEnd.getTime(), addDays(today, 1).getTime())) : plannedEnd;
    latest = new Date(Math.max(latest.getTime(), actualEnd.getTime(), plannedEnd.getTime()));
    const [state, color] = STATE[s.status];
    const mark = (id: string, name: string, at: string | undefined, eventColor: string): TaskModelConfig[] =>
      at ? [{ id: `${s.id}-${id}`, name, startDate: day(at), duration: 0, manuallyScheduled: true, eventColor }] : [];
    const marks = [...mark('hold', 'PayPal holds the money', s.fundedAt, 'blue'), ...mark('delivered', 'Work delivered', s.deliveredAt, 'violet'), ...mark('paid', 'PayPal paid the freelancer', s.paidAt, 'green')];
    const task: TaskModelConfig & { amount: string; state: string } = {
      id: s.id,
      name: `${s.stage}. ${s.title}`,
      amount: fmtMoney(s.paid ?? s.amount, currency),
      state,
      startDate: actualStart,
      endDate: actualEnd,
      manuallyScheduled: true,
      percentDone: DONE[s.status],
      eventColor: color,
      baselines: [{ startDate: plannedStart, endDate: plannedEnd }],
      expanded: !closed && !!s.fundedAt,
      children: marks,
    };
    return task;
  });
  const dependencies = stages.slice(1).map((s, i) => ({ id: `dep-${s.id}`, fromTask: stages[i].id, toTask: s.id }));
  return { tasks, dependencies, start: addDays(day(stages[0].createdAt), -1), end: addDays(latest, 2) };
}

const PHONE = '(max-width: 639px)';
const subscribePhone = (onChange: () => void) => {
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

export function ProjectTimeline({ stages, currency }: { stages: StageSummary[]; currency: string }) {
  // The deal page polls every few seconds with fresh objects; the Gantt is rebuilt only when a stage
  // actually changed (handing Bryntum new configs each time made it re-create its parts and throw).
  const signature = JSON.stringify(stages);
  const { tasks, dependencies, start, end } = useMemo(() => timeline(JSON.parse(signature) as StageSummary[], currency), [signature, currency]);
  const project = useMemo(() => ({ taskModelClass: StageTask, tasks, dependencies }), [tasks, dependencies]);
  // On a phone the stage names alone, so the timeline keeps most of the width.
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
  const columns = useMemo<GridColumnConfig[]>(
    () => [
      { type: 'name', text: 'Stage', flex: 1, minWidth: 140 },
      { text: 'Amount', field: 'amount', width: 112, align: 'right', hidden: phone },
      { text: 'Status', field: 'state', width: 150, hidden: phone },
    ],
    [phone],
  );
  const subGrids = useMemo(() => ({ locked: { width: phone ? 170 : 540 } }), [phone]);
  const timeRanges = useMemo(() => ({ showCurrentTimeLine: true }), []);

  const rows = tasks.reduce((n, t) => n + 1 + (t.expanded ? (t.children as TaskModelConfig[]).length : 0), 0);
  return (
    <div className="pod-gantt overflow-hidden rounded-xl border border-pp-border" style={{ height: 110 + rows * 46 }}>
      <BryntumGantt
        // Built once per layout: the split between the grid and the timeline is set at creation.
        key={phone ? 'phone' : 'wide'}
        readOnly
        project={project}
        startDate={start}
        endDate={end}
        viewPreset={(end.getTime() - start.getTime()) / DAY > 28 ? 'weekAndMonth' : 'weekAndDayLetter'}
        rowHeight={44}
        barMargin={9}
        zoomOnMouseWheel={false}
        columns={columns}
        subGridConfigs={subGrids}
        baselinesFeature
        dependenciesFeature
        timeRangesFeature={timeRanges}
        projectLinesFeature={false}
        taskEditFeature={false}
        taskMenuFeature={false}
        cellEditFeature={false}
        headerMenuFeature={false}
      />
    </div>
  );
}
