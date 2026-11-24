import type { ConstructionControl, ControlChapter, PlanningRow } from "@repo/core/contract";
import { scheduleStatus } from "@repo/core/contract";
import { chapterTiming } from "@repo/core/control-calc";
import { control, controlChapter } from "./construction-fixture";
import { planning, planningRows, TODAY } from "./planning-fixture";

// The construction control of the project in ./planning-fixture (VTH-26-001
// on Monday 19 October 2026, baseline v2), as Planificación loads it beside
// the plan: the same chapters, their planned dates the baseline's.

/** A plan's row as the control has it, timed as core does (cost and contracting left as the fixture's). */
export function chapterOf(row: PlanningRow, overrides: Partial<ControlChapter> = {}): ControlChapter {
  return controlChapter({
    code: row.code,
    name: row.name,
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedEnd,
    actualStart: row.actualStart,
    actualEnd: row.actualEnd,
    ...chapterTiming(row, { start: row.plannedStart, end: row.plannedEnd }, TODAY),
    hitoCode: row.hitoCode,
    openIssues: 0,
    ...overrides,
  });
}

const chapters = planningRows.map((row) => chapterOf(row));

export const planningControl: ConstructionControl = {
  ...control,
  project: { ...control.project, startDate: planning.startDate, completionDate: planning.completionDate },
  today: TODAY,
  chapters,
  sources: { planning: "live", purchasing: "live" },
  schedule: scheduleStatus({ chapters, planning: "live", forecast: planning.baseline!.forecast, today: TODAY }),
};
