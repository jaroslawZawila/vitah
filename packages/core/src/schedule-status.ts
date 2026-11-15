import type { ChapterState, PlanningCheck, PlanningSource, ProjectSchedule, ScheduleLateChapter, ScheduleStatus } from "./contract";
import { daysBetween } from "./subcontractor-rules";

// ─── Schedule status ─────────────────────────────────────────────────────────
// Whether an obra is on time, the one rule the portal states (Obra › Resumen
// and Planificación read it from ./planning's `obraSchedule`, so they can't
// disagree). Pure and DB-free, through @repo/core/contract.
// ─────────────────────────────────────────────────────────────────────────────

/** A contract chapter as the rule reads it: its state from Avance, its planned dates (null when it has none). */
export type ScheduleChapterInput = {
  code: string;
  name: string;
  state: ChapterState;
  plannedStart: string | null;
  plannedEnd: string | null;
};

/** Days a chapter is late to start on `today`: pending, its planned start before today; else null. */
export function lateToStartDays(state: ChapterState, plannedStart: string | null, today: string): number | null {
  return state === "pending" && plannedStart !== null && plannedStart < today ? daysBetween(plannedStart, today) : null;
}

/** Days a chapter is late to finish on `today`: in progress, its planned end before today; else null. */
export function lateToFinishDays(state: ChapterState, plannedEnd: string | null, today: string): number | null {
  return state === "in_progress" && plannedEnd !== null && plannedEnd < today ? daysBetween(plannedEnd, today) : null;
}

const mostDaysFirst = (a: ScheduleLateChapter, b: ScheduleLateChapter) => b.days - a.days || a.code.localeCompare(b.code);

/**
 * How the obra stands against its plan on `today`. A chapter is late to start
 * when it is pending and its planned start is before today, late to finish when
 * it is in progress and its planned end is before today (as each chapter's pill
 * says). With the approved baseline (`planning: "live"`), the obra is on time
 * only when no chapter is late and the baseline's `forecast` doesn't end after
 * the contract's date; otherwise it is late. Simulated dates (`"mock"`) never
 * make it on time or late: the late chapters are still listed, measured against
 * them. No "at risk" in between: nothing in the data draws that line.
 */
export function scheduleStatus(input: {
  chapters: ScheduleChapterInput[];
  planning: PlanningSource;
  /** The approved baseline's forecast against the contract; null without one. */
  forecast: PlanningCheck | null;
  today: string;
}): ScheduleStatus {
  const { chapters, planning, today } = input;
  const forecast = planning === "live" ? input.forecast : null;
  const behind = ({ code, name }: ScheduleChapterInput, date: string | null, days: number | null): ScheduleLateChapter[] =>
    date !== null && days !== null ? [{ code, name, plannedDate: date, days }] : [];
  const lateToStart = chapters
    .flatMap((c) => behind(c, c.plannedStart, lateToStartDays(c.state, c.plannedStart, today)))
    .sort(mostDaysFirst);
  const lateToFinish = chapters
    .flatMap((c) => behind(c, c.plannedEnd, lateToFinishDays(c.state, c.plannedEnd, today)))
    .sort(mostDaysFirst);

  const forecastLate = (forecast?.delayDays ?? 0) > 0;
  const [finish] = lateToFinish;
  const [start] = lateToStart;
  const worst = forecastLate
    ? "forecast"
    : finish && (!start || finish.days >= start.days)
      ? "finish"
      : start
        ? "start"
        : null;

  const hasDates = chapters.some((c) => c.plannedStart !== null) || forecast !== null;
  const status: ScheduleStatus["status"] =
    planning === "mock" ? (hasDates ? "simulated" : "no_dates") : worst !== null ? "late" : hasDates ? "on_time" : "no_dates";
  return { status, planning, forecast, lateToStart, lateToFinish, worst };
}

/** The status as the project list shows it: when late, the days of what it leads with (as Resumen's headline). */
export function projectSchedule({ status, worst, forecast, lateToFinish, lateToStart }: ScheduleStatus): ProjectSchedule {
  const days =
    worst === "forecast" ? forecast!.delayDays : worst === "finish" ? lateToFinish[0]!.days : worst === "start" ? lateToStart[0]!.days : null;
  return { status, worst, days: status === "late" ? days : null };
}
