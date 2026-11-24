// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

import type { ChapterState, PlanningSource } from "./construction";
import type { ObraStage } from "./obra";

// ─── Planning (the works schedule) ───────────────────────────────────────────
// Each contract chapter's planned dates (packages/core/src/planning.ts): the
// first in the list starts with the works, every other after the one above it
// ends (plus a lag in calendar days, negative to overlap), and lasts a number
// of working days of the project's calendar. A draft is edited freely; approving it makes it the
// baseline Avance, Compras and the Obra tab measure against. A change is a new
// version with its reason; the old ones are kept. Staff only, portal only.

/** Autonomous communities whose holidays the calendar knows (ISO 3166-2:ES); none = national only. */
export const PLANNING_REGIONS = ["as", "cb", "cl", "ga", "md"] as const;
export type PlanningRegion = (typeof PLANNING_REGIONS)[number];

export type PlanningCalendar = {
  region: PlanningRegion | null;
  /** The four weeks of August off (Monday of the first full week). */
  augustClosure: boolean;
  /** 24 December to 6 January off. */
  christmasClosure: boolean;
};

export type PlanningStatus = "draft" | "approved" | "superseded";

/** A chapter lasts 1 to this many working days. */
export const MAX_PLAN_DURATION_DAYS = 600;
/** A lag after the chapter above goes from minus to plus this many calendar days. */
export const MAX_PLAN_LAG_DAYS = 250;

/** How a chapter's start is set. */
export type PlanningRule = {
  /**
   * Starts on the first working day from the day after this chapter ends plus
   * `lagDays` (calendar days); null = with the works. In a draft, the chapter
   * above it in the list (`chainRules`).
   */
  after: string | null;
  lagDays: number;
  /** Working days. */
  durationDays: number;
  /** Always null in what core answers: a fixed start was dropped with the start rules (kept for older clients). */
  fixedStart: string | null;
  /** Runs from the works' start to the last chapter's end (17, 18, 19). */
  spansWorks: boolean;
};

export type PlanningItemInput = PlanningRule & { code: string };

/** One chapter of a version: its rule, its dates, and where it stands on site. */
export type PlanningRow = PlanningRule & {
  code: string;
  name: string;
  hitoCode: string | null;
  /** The version's dates (a baseline's never move). */
  plannedStart: string;
  plannedEnd: string;
  /** Where it is heading now, from what Avance recorded and today. */
  forecastStart: string;
  forecastEnd: string;
  state: ChapterState;
  actualStart: string | null;
  actualEnd: string | null;
  progressPct: number;
  /** On the chain of chapters that sets the end. */
  critical: boolean;
};

export type PlanningVersionSummary = {
  id: string;
  number: number;
  status: PlanningStatus;
  reason: string | null;
  startDate: string;
  endDate: string;
  createdBy: string | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
};

/** How a plan's end compares with the contract. */
export type PlanningCheck = {
  endDate: string;
  /** The contract's completion date; null when the project has none. */
  contractEnd: string | null;
  /** End − contract, calendar days (late > 0); null without a contract date. */
  delayDays: number | null;
};

/** A chapter behind its planned dates today: `plannedDate` is the start (late to start) or end (late to finish) it passed. */
export type ScheduleLateChapter = { code: string; name: string; plannedDate: string; days: number };

/**
 * Whether the obra is on time: the one rule the portal states, on Obra ›
 * Resumen and Planificación alike (`scheduleStatus` in ./schedule-status).
 * - `on_time`: an approved baseline, and nothing contradicts it
 * - `late`: an approved baseline, and its forecast ends after the contract,
 *   or a chapter is late to start or to finish
 * - `simulated`: no approved baseline; the dates are a stand-in, so nothing is asserted
 * - `no_dates`: nothing to measure against (no baseline and no project dates)
 */
export type ScheduleStatus = {
  status: "on_time" | "late" | "simulated" | "no_dates";
  planning: PlanningSource;
  /** Where the approved baseline is heading against the contract; null without one. */
  forecast: PlanningCheck | null;
  /** Pending chapters whose planned start has passed, most days first. */
  lateToStart: ScheduleLateChapter[];
  /** Chapters in progress past their planned end, most days first. */
  lateToFinish: ScheduleLateChapter[];
  /** What to lead with: the forecast past the contract, else the chapter most days behind (finish before start on a tie). */
  worst: "forecast" | "finish" | "start" | null;
};

/** GET /api/v1/projects/:id/planning: the Obra tab's Planificación. */
export type ProjectPlanning = {
  ref: string;
  stage: ObraStage;
  /** The acta de inicio and contract dates on the project. */
  startDate: string | null;
  completionDate: string | null;
  baseline:
    | (PlanningVersionSummary & {
        calendar: PlanningCalendar;
        rows: PlanningRow[];
        /** Where the works are heading, from the baseline and what happened. */
        forecast: PlanningCheck;
        planned: PlanningCheck;
      })
    | null;
  /** On time or late: the same as GET …/obra/control's `schedule`. */
  schedule: ScheduleStatus;
  draft: PlanningVersionSummary | null;
  /** The contract's chapters (chapter 20 aside), to generate a first plan from. */
  chapters: { code: string; name: string }[];
  /** Other projects with a baseline, to copy one from. */
  copyFrom: { projectId: string; ref: string }[];
  today: string;
};

/** GET /api/v1/projects/:id/planning/draft (the portal checks it against the contract as staff edit). */
export type PlanningDraft = {
  ref: string;
  version: PlanningVersionSummary;
  calendar: PlanningCalendar;
  rows: PlanningRow[];
  /** The baseline it would replace; null for a first plan. */
  baseline: { number: number } | null;
  completionDate: string | null;
  today: string;
};

/** GET /api/v1/projects/:id/planning/versions: every version, newest first, with its dates. */
export type PlanningVersions = {
  ref: string;
  versions: (PlanningVersionSummary & {
    rows: { code: string; name: string; plannedStart: string; plannedEnd: string }[];
  })[];
};
