import type { ChapterState, MilestoneState } from "./contract";
import { addDays, ofBp } from "./obra-calc";
import { daysBetween } from "./subcontractor-rules";

// ─── Construction control arithmetic ─────────────────────────────────────────
// Pure functions behind ./construction: a chapter's state and delays from its
// dates, a hito's state, and the stand-ins for the modules that don't exist
// yet (Planning's dates, Purchasing's contracted amounts). No database.
// ─────────────────────────────────────────────────────────────────────────────

export { daysBetween };

/** Days from `start` to `end`, both counted. */
export const spanDays = (start: string, end: string) => daysBetween(start, end) + 1;

type Dates = { actualStart: string | null; actualEnd: string | null };

/** Only the recorded dates decide: none = pending, a start = in progress, an end too = finished. */
export function chapterState(dates: Dates | undefined): ChapterState {
  if (dates?.actualEnd) return "finished";
  if (dates?.actualStart) return "in_progress";
  return "pending";
}
type Plan = { start: string; end: string } | undefined;

/** How the chapter's dates compare with the plan, as of `today`. */
export function chapterTiming(dates: Dates | undefined, plan: Plan, today: string) {
  const state = chapterState(dates);
  const start = dates?.actualStart ?? null;
  const end = dates?.actualEnd ?? null;
  return {
    state,
    startDelayDays: plan && start ? daysBetween(plan.start, start) : null,
    endDelayDays: plan && end ? daysBetween(plan.end, end) : null,
    // Passing a planned date changes nothing by itself; it is only shown.
    overdueDays: plan && state === "in_progress" && today > plan.end ? daysBetween(plan.end, today) : null,
    plannedDays: plan ? spanDays(plan.start, plan.end) : null,
    actualDays: start ? spanDays(start, end ?? today) : null,
  };
}

/** A hito's place, from its chapters, its invoice request and what Sales recorded. */
export function milestoneState(hito: {
  chapterStates: ChapterState[];
  requested: boolean;
  invoicedOn: string | null;
  paidOn: string | null;
}): MilestoneState {
  if (hito.paidOn) return "collected";
  if (hito.invoicedOn) return "invoiced";
  if (hito.requested) return "requested";
  return milestoneMet(hito.chapterStates) ? "reached" : "pending";
}

/** Every chapter of a hito is finished: it can be invoiced. */
export function milestoneMet(states: ChapterState[]) {
  return states.length > 0 && states.every((s) => s === "finished");
}

/**
 * Whether finishing `code` now asks for its hito's invoice: it's the hito's
 * last chapter not finished, and none was asked for yet. The finish dialog
 * says so before it happens.
 */
export function finishRequestsInvoice(
  hito: { chapters: { code: string; state: ChapterState }[]; requested: boolean },
  code: string,
) {
  return !hito.requested && milestoneMet(hito.chapters.map((c) => (c.code === code ? "finished" : c.state)));
}

// ─── Planning (simulated) ────────────────────────────────────────────────────
// Until Planning exists, each chapter's planned dates come from the project's
// start and completion dates: the hitos follow one another, each taking a
// share of the time equal to its share of the price, and their chapters run
// through it. Quality control, health and safety and waste management run
// through the whole works.

const WHOLE_WORKS = new Set(["17", "18", "19"]);

/**
 * Planned dates by chapter code. `hitos` in order, with the codes of their
 * chapters that are in the contract; chapters without a hito span the works.
 */
export function plannedDates(
  works: { startDate: string | null; completionDate: string | null },
  hitos: { pctBp: number; chapterCodes: string[] }[],
  chapterCodes: string[],
): Map<string, { start: string; end: string }> {
  const plan = new Map<string, { start: string; end: string }>();
  const { startDate, completionDate } = works;
  if (!startDate || !completionDate || completionDate < startDate) return plan;
  const whole = { start: startDate, end: completionDate };

  const slices = hitos
    .map((h) => ({ ...h, chapterCodes: h.chapterCodes.filter((c) => !WHOLE_WORKS.has(c)) }))
    .filter((h) => h.chapterCodes.length > 0);
  const totalBp = slices.reduce((sum, h) => sum + h.pctBp, 0);
  const totalDays = spanDays(startDate, completionDate);
  let usedBp = 0;
  slices.forEach((hito, index) => {
    const from = Math.floor((totalDays * usedBp) / (totalBp || 1));
    usedBp += hito.pctBp;
    const last = index === slices.length - 1;
    const to = last ? totalDays : Math.max(from + 1, Math.floor((totalDays * usedBp) / (totalBp || 1)));
    const slice = { start: addDays(startDate, from), end: addDays(startDate, to - 1) };
    for (const code of hito.chapterCodes) plan.set(code, slice);
  });
  for (const code of chapterCodes) if (!plan.has(code)) plan.set(code, whole);
  return plan;
}

// ─── Purchasing (simulated) ──────────────────────────────────────────────────
// Until Purchasing exists, a line counts as contracted once its chapter is
// finished, and for most lines of a chapter in progress; its contracted amount
// is its cost give or take up to 6 %, stable for the line (by its lineage).

const MAX_SPREAD_BP = 600;

/** A stable 32-bit hash (FNV-1a). */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** What a line was contracted for; null when it isn't contracted (yet). */
export function contractedCents(line: { lineageId: string; costCents: number }, state: ChapterState): number | null {
  if (state === "pending" || line.costCents <= 0) return null;
  const h = hash(line.lineageId);
  if (state === "in_progress" && h % 3 === 0) return null;
  const spreadBp = (h % (2 * MAX_SPREAD_BP + 1)) - MAX_SPREAD_BP;
  return line.costCents + ofBp(line.costCents, spreadBp);
}

/** Cost − contracted (a saving is positive), and as bp of the cost; nulls when not contracted. */
export function deviation(costCents: number, contracted: number | null) {
  if (contracted === null) return { deviationCents: null, deviationBp: null };
  const deviationCents = costCents - contracted;
  return { deviationCents, deviationBp: costCents ? Math.round((deviationCents * 10_000) / costCents) : 0 };
}
