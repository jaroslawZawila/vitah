import type { PlanningDraft, PlanningRow, PlanningVersions, ProjectPlanning } from "@repo/core/contract";

// What the Planificación screens get from core, for their tests: VTH-26-001
// mid-works on Monday 19 October 2026 with baseline v2, 01 finished, 02 and
// 17 in progress, 03 and 04 pending (03 late on the baseline).

export const TODAY = "2026-10-19";

const row = (r: Partial<PlanningRow> & Pick<PlanningRow, "code" | "name">): PlanningRow => ({
  hitoCode: null,
  after: null,
  lagDays: 0,
  durationDays: 10,
  fixedStart: null,
  spansWorks: false,
  leadDays: 14,
  plannedStart: "2026-03-02",
  plannedEnd: "2026-03-13",
  forecastStart: "2026-03-02",
  forecastEnd: "2026-03-13",
  state: "pending",
  actualStart: null,
  actualEnd: null,
  progressPct: 0,
  critical: false,
  ...r,
});

export const planningRows: PlanningRow[] = [
  row({
    code: "01",
    name: "Actuaciones previas y movimiento de tierras",
    hitoCode: "H2",
    forecastEnd: "2026-03-16",
    state: "finished",
    actualStart: "2026-03-02",
    actualEnd: "2026-03-16",
    progressPct: 100,
  }),
  row({
    code: "02",
    name: "Cimentación y estructura",
    hitoCode: "H3",
    after: "01",
    durationDays: 140,
    plannedStart: "2026-03-16",
    plannedEnd: "2026-10-23",
    forecastStart: "2026-03-17",
    forecastEnd: "2026-10-30",
    state: "in_progress",
    actualStart: "2026-03-17",
    progressPct: 70,
    critical: true,
  }),
  row({
    code: "03",
    name: "Revestimientos interiores y falsos techos",
    hitoCode: "H8",
    after: "02",
    durationDays: 20,
    plannedStart: "2026-10-26",
    plannedEnd: "2026-11-20",
    forecastStart: "2026-11-02",
    forecastEnd: "2026-11-27",
    critical: true,
  }),
  row({
    code: "04",
    name: "Pinturas y varios",
    hitoCode: "H9",
    after: "03",
    durationDays: 13,
    plannedStart: "2026-11-23",
    plannedEnd: "2026-12-10",
    forecastStart: "2026-11-30",
    forecastEnd: "2026-12-17",
    critical: true,
  }),
  row({
    code: "17",
    name: "Control de calidad",
    spansWorks: true,
    durationDays: 1,
    plannedEnd: "2026-12-10",
    forecastEnd: "2026-12-17",
    state: "in_progress",
    actualStart: "2026-03-02",
    progressPct: 80,
  }),
];

const calendar = { region: "as" as const, augustClosure: true, christmasClosure: true };

export const planning: ProjectPlanning = {
  ref: "VTH-26-001",
  stage: 6,
  startDate: "2026-03-02",
  completionDate: "2026-12-11",
  baseline: {
    id: "v2",
    number: 2,
    status: "approved",
    reason: "Lluvias de septiembre",
    startDate: "2026-03-02",
    endDate: "2026-12-10",
    createdBy: "Jorge Ruiz",
    createdAt: "2026-10-09T09:00:00.000Z",
    approvedBy: "Laura Martín",
    approvedAt: "2026-10-12T09:00:00.000Z",
    calendar,
    rows: planningRows,
    planned: { endDate: "2026-12-10", contractEnd: "2026-12-11", delayDays: -1, penaltyCents: 0 },
    forecast: { endDate: "2026-12-17", contractEnd: "2026-12-11", delayDays: 6, penaltyCents: 0 },
  },
  draft: null,
  chapters: planningRows.map(({ code, name }) => ({ code, name })),
  copyFrom: [{ projectId: "p-2", ref: "VTH-26-002" }],
  today: TODAY,
};

/** No plan yet: what the first visit to Planificación gets. */
export const emptyPlanning: ProjectPlanning = { ...planning, baseline: null, draft: null };

export const planningDraft: PlanningDraft = {
  ref: "VTH-26-001",
  version: {
    id: "v3",
    number: 3,
    status: "draft",
    reason: null,
    startDate: "2026-03-02",
    endDate: "2026-12-17",
    createdBy: "Jorge Ruiz",
    createdAt: "2026-10-19T08:00:00.000Z",
    approvedBy: null,
    approvedAt: null,
  },
  calendar,
  rows: planningRows,
  baseline: { number: 2, ends: { "01": "2026-03-13", "02": "2026-10-23", "03": "2026-11-20", "04": "2026-12-10", "17": "2026-12-10" } },
  completionDate: "2026-12-11",
  contractCents: 448_205_05,
  today: TODAY,
};

const version = (v: Partial<PlanningVersions["versions"][number]> & { id: string; number: number }) => ({
  status: "superseded" as const,
  reason: null,
  startDate: "2026-03-02",
  endDate: "2026-12-10",
  createdBy: "Jorge Ruiz",
  createdAt: "2026-02-20T09:00:00.000Z",
  approvedBy: "Laura Martín",
  approvedAt: "2026-02-27T09:00:00.000Z",
  rows: planningRows.map(({ code, name, plannedStart, plannedEnd }) => ({ code, name, plannedStart, plannedEnd })),
  ...v,
});

export const planningVersions: PlanningVersions = {
  ref: "VTH-26-001",
  versions: [
    version({ id: "v3", number: 3, status: "draft", endDate: "2026-12-17", approvedBy: null, approvedAt: null, createdAt: "2026-10-19T08:00:00.000Z" }),
    version({ id: "v2", number: 2, status: "approved", reason: "Lluvias de septiembre", approvedAt: "2026-10-12T09:00:00.000Z" }),
    version({
      id: "v1",
      number: 1,
      endDate: "2026-12-03",
      rows: planningRows.map(({ code, name, plannedStart, plannedEnd }) =>
        code === "04"
          ? { code, name, plannedStart: "2026-11-16", plannedEnd: "2026-12-03" }
          : { code, name, plannedStart, plannedEnd },
      ),
    }),
  ],
};
