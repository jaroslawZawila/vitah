import {
  CONTINGENCY_CHAPTER,
  isOpenOrder,
  type ChapterState,
  type MilestoneState,
  type PlanningSource,
  type PurchaseKind,
  type PurchaseStatus,
} from "./contract";
import { addDays } from "./obra-calc";
import { templateLeadDays } from "./planning-calc";
import { daysBetween } from "./subcontractor-rules";

// ─── Construction control arithmetic ─────────────────────────────────────────
// Pure functions behind ./construction: a chapter's state and delays from its
// dates, a hito's state, a line's deviation, and the stand-in for Planning's
// dates while a project has no approved baseline. No database.
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
// Until a project's Planning baseline is approved, each chapter's planned
// dates come from the project's start and completion dates: the hitos follow
// one another, each taking a share of the time equal to its share of the
// price, and their chapters run through it. Quality control, health and safety and waste management run
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

/**
 * The contract's chapters to build (chapter 20, the contingency reserve,
 * aside), each one's state from its recorded dates, and the planned dates and lead time:
 * the approved Planning baseline's (`approved`), else simulated. A chapter the
 * baseline lacks (added to the contract since) has no planned dates.
 */
export function contractSchedule<C extends { code: string }>(
  chapters: C[],
  hitos: { pctBp: number; chapters: { code: string }[] }[],
  progress: (Dates & { chapterCode: string })[],
  works: { startDate: string | null; completionDate: string | null },
  approved: ReadonlyMap<string, { start: string; end: string; leadDays: number }> | null = null,
) {
  const items = chapters.filter((c) => c.code !== CONTINGENCY_CHAPTER);
  const dates = new Map(progress.map((row) => [row.chapterCode, row]));
  const states = new Map(items.map((c) => [c.code, chapterState(dates.get(c.code))]));
  // With each chapter's lead time: the baseline's, or the standard one with the simulated dates.
  const plan = approved
    ? new Map(items.flatMap((c) => (approved.has(c.code) ? [[c.code, approved.get(c.code)!] as const] : [])))
    : new Map(
        [
          ...plannedDates(
            works,
            hitos.map((h) => ({ pctBp: h.pctBp, chapterCodes: h.chapters.map((c) => c.code) })),
            items.map((c) => c.code),
          ),
        ].map(([code, dates]) => [code, { ...dates, leadDays: templateLeadDays(code) }] as const),
      );
  const planSource: PlanningSource = approved ? "live" : "mock";
  return { items, dates, states, plan, planSource };
}

// ─── Purchasing ──────────────────────────────────────────────────────────────

/** Days `today` is past `date`; null when there is no date or it hasn't passed. */
export const daysPast = (date: string | null, today: string): number | null =>
  date !== null && date < today ? daysBetween(date, today) : null;

/** A material order past its expected delivery and not delivered: days late on `today`; else null. */
export function lateDays(
  order: { kind: PurchaseKind; status: PurchaseStatus; expectedOn: string | null },
  today: string,
): number | null {
  return order.kind === "material" && isOpenOrder(order.status) ? daysPast(order.expectedOn, today) : null;
}

/** What a budget line (by lineage) has contracted: its counting orders' sum, and whether one closes it. */
export type LineContract = {
  contractedCents: number;
  closed: boolean;
  orders: { id: string; number: number; supplierName: string; lateDays: number | null }[];
};

/**
 * Budget lines' contracting summed up: what is contracted (closed lines or
 * not), how many lines are closed, open or not ordered (those costing
 * something), and the deviation
 * over the closed ones only, so a line with more still to order never counts
 * as a saving.
 */
export function contractTotals(
  lines: { lineageId: string; amountCents: number }[],
  contracts: ReadonlyMap<string, Pick<LineContract, "contractedCents" | "closed">>,
) {
  let contractedCents = 0;
  let closedLines = 0;
  let openLines = 0;
  let closedCostCents = 0;
  let closedContractedCents = 0;
  let uncontractedLines = 0;
  let uncontractedCostCents = 0;
  for (const line of lines) {
    const contract = contracts.get(line.lineageId);
    if (!contract) {
      // A line that costs nothing (or deducts) has nothing to order.
      if (line.amountCents > 0) {
        uncontractedLines++;
        uncontractedCostCents += line.amountCents;
      }
      continue;
    }
    contractedCents += contract.contractedCents;
    if (!contract.closed) {
      openLines++;
      continue;
    }
    closedLines++;
    closedCostCents += line.amountCents;
    closedContractedCents += contract.contractedCents;
  }
  return {
    contractedCents,
    closedLines,
    openLines,
    closedCostCents,
    uncontractedLines,
    uncontractedCostCents,
    ...deviation(closedCostCents, closedLines > 0 ? closedContractedCents : null),
  };
}

/** Contracted − cost (an overrun is positive, a saving negative), and as bp of the cost; nulls when not contracted. */
export function deviation(costCents: number, contracted: number | null) {
  if (contracted === null) return { deviationCents: null, deviationBp: null };
  const deviationCents = contracted - costCents;
  return { deviationCents, deviationBp: costCents ? Math.round((deviationCents * 10_000) / costCents) : 0 };
}
