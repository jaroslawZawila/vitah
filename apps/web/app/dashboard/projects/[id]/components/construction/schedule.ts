import { lateToStartDays, type ControlChapter, type ControlMilestone, type ScheduleStatus } from "@repo/core/contract";
import { finishRequestsInvoice } from "@repo/core/control-calc";
import { daysBetween } from "./format";

// Pure rules of the Obra tab's views: how a chapter stands against its plan
// and when finishing a chapter completes its hito.

/** A pending chapter whose planned start is this close shows "starts in n d". */
const SOON_DAYS = 14;

export type ScheduleTone = "good" | "yel" | "warn" | "muted";

/**
 * How a chapter stands against Planning's dates, or null when nothing can be
 * said (no plan, or a finished one without a planned end).
 * - finished: `late` (+n d past the planned end) or `onTime`
 * - in progress: `overdue` (past the planned end), `startLate`, or `onTime`
 * - pending: `notStarted` (its planned start has passed) or `startsIn` (soon)
 */
export function scheduleOf(
  chapter: ControlChapter,
  today: string,
): { tone: ScheduleTone; key: "late" | "onTime" | "overdue" | "startLate" | "notStarted" | "startsIn"; days: number } | null {
  if (chapter.state === "finished") {
    if (chapter.endDelayDays === null) return null;
    return chapter.endDelayDays > 0
      ? { tone: "yel", key: "late", days: chapter.endDelayDays }
      : { tone: "good", key: "onTime", days: 0 };
  }
  if (chapter.state === "in_progress") {
    if (chapter.overdueDays !== null && chapter.overdueDays > 0) {
      return { tone: "warn", key: "overdue", days: chapter.overdueDays };
    }
    if (chapter.startDelayDays !== null && chapter.startDelayDays > 0) {
      return { tone: "yel", key: "startLate", days: chapter.startDelayDays };
    }
    return chapter.plannedStart ? { tone: "good", key: "onTime", days: 0 } : null;
  }
  if (!chapter.plannedStart) return null;
  // Late to start: core's rule, the same as the obra's schedule status.
  const late = lateToStartDays(chapter.state, chapter.plannedStart, today);
  if (late !== null) return { tone: "warn", key: "notStarted", days: late };
  const days = daysBetween(today, chapter.plannedStart);
  return days <= SOON_DAYS ? { tone: "muted", key: "startsIn", days } : null;
}

/** The tone of the obra's schedule status (core's `scheduleStatus`), the same wherever it shows. */
export const STATUS_TONE: Record<ScheduleStatus["status"], ScheduleTone> = {
  on_time: "good",
  late: "warn",
  simulated: "muted",
  no_dates: "muted",
};

/**
 * Whether finishing `code` completes its hito and asks Administration for
 * the invoice: every other chapter of the hito is finished and the hito has
 * no request yet (it never gets a second one).
 */
export function completesMilestone(milestone: ControlMilestone | null | undefined, code: string) {
  if (!milestone || !milestone.chapters.some((c) => c.code === code)) return false;
  return finishRequestsInvoice({ chapters: milestone.chapters, requested: milestone.request !== null }, code);
}

/** A chapter's span as far as it is known: actual dates first, then the plan (in progress: until today at least). */
export function spanOf(chapter: ControlChapter, today: string) {
  const start = chapter.actualStart ?? chapter.plannedStart;
  const end =
    chapter.actualEnd ??
    (chapter.state === "in_progress"
      ? [chapter.plannedEnd, today].filter((d): d is string => !!d).sort().at(-1)!
      : chapter.plannedEnd);
  return { start, end };
}

/** Whether a chapter falls (even in part) in the period [from, to]; an open end matches anything. */
export function inPeriod(chapter: ControlChapter, today: string, from: string, to: string) {
  const { start, end } = spanOf(chapter, today);
  if (from && end && end < from) return false;
  if (to && start && start > to) return false;
  return true;
}
