import {
  MAX_PLAN_DURATION_DAYS,
  MAX_PLAN_LAG_DAYS,
  type PlanningCalendar,
  type PlanningCheck,
  type PlanningItemInput,
  type PlanningRegion,
} from "./contract";
import { addDays } from "./obra-calc";
import { daysBetween } from "./subcontractor-rules";

export { isCalendarDate } from "./calendar";

// ─── Planning arithmetic ─────────────────────────────────────────────────────
// Pure functions behind ./planning, also used by the portal to recompute a
// draft as staff type: the working calendar, the standard plan, the chain the
// list's order makes, each chapter's dates, the critical path and the check
// against the contract. No database.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Working calendar ────────────────────────────────────────────────────────

/** Easter Sunday of `year` (Gregorian, anonymous algorithm). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const NATIONAL = ["01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"];

/** Each community's own days (fixed dates); all of them also keep Holy Thursday. */
const REGIONAL: Record<PlanningRegion, string[]> = {
  as: ["09-08"],
  cb: ["07-28", "09-15"],
  cl: ["04-23"],
  ga: ["05-17", "07-25"],
  md: ["05-02"],
};

/** The bank holidays of `year`: national (Good Friday too) and the region's (Holy Thursday too). */
export function holidaysOf(year: number, region: PlanningRegion | null): Set<string> {
  const easter = easterSunday(year);
  const days = NATIONAL.map((md) => `${year}-${md}`);
  days.push(addDays(easter, -2));
  if (region) {
    days.push(addDays(easter, -3));
    days.push(...REGIONAL[region].map((md) => `${year}-${md}`));
  }
  return new Set(days);
}

/** The Monday August's closure starts on: the first Monday of the month. */
function augustClosureStart(year: number): string {
  let day = `${year}-08-01`;
  while (new Date(`${day}T00:00:00Z`).getUTCDay() !== 1) day = addDays(day, 1);
  return day;
}

export type WorkCalendar = {
  isWorkDay(date: string): boolean;
  /** `date` if it is a working day, else the next one. */
  nextWorkDay(date: string): string;
  /** `n` working days after `date` (before it when negative); `date` itself when 0. */
  addWorkDays(date: string, n: number): string;
};

/** Weekends, bank holidays and the closures chosen are not working days. */
export function workCalendar(calendar: PlanningCalendar): WorkCalendar {
  const years = new Map<number, Set<string>>();
  const offDays = (year: number) => {
    let days = years.get(year);
    if (!days) {
      days = holidaysOf(year, calendar.region);
      if (calendar.augustClosure) {
        const start = augustClosureStart(year);
        for (let i = 0; i < 28; i++) days.add(addDays(start, i));
      }
      years.set(year, days);
    }
    return days;
  };
  const isWorkDay = (date: string) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) return false;
    const md = date.slice(5);
    if (calendar.christmasClosure && (md >= "12-24" || md <= "01-06")) return false;
    return !offDays(Number(date.slice(0, 4))).has(date);
  };
  const nextWorkDay = (date: string) => {
    let day = date;
    while (!isWorkDay(day)) day = addDays(day, 1);
    return day;
  };
  const addWorkDays = (date: string, n: number) => {
    let day = date;
    const step = n >= 0 ? 1 : -1;
    for (let left = Math.abs(n); left > 0; ) {
      day = addDays(day, step);
      if (isWorkDay(day)) left--;
    }
    return day;
  };
  return { isWorkDay, nextWorkDay, addWorkDays };
}

// ─── The sequence ────────────────────────────────────────────────────────────

/** Quality control, health and safety and waste management run through the whole works. */
export const SPANS_WORKS = new Set(["17", "18", "19"]);

/**
 * `items` as a draft runs them: the first chapter (17–19 aside) starts with
 * the works, every other one after the chapter above it in the list ends,
 * plus its lag; none on a fixed day. The list's order is the sequence.
 */
export function chainRules<T extends PlanningItemInput>(items: T[]): T[] {
  let before: string | null = null;
  return items.map((item) => {
    if (item.spansWorks) return item;
    const chained = { ...item, after: before, lagDays: before ? item.lagDays : 0, fixedStart: null };
    before = item.code;
    return chained;
  });
}

/** `items` with the chapters that don't span the works replaced, in turn, by `working`; 17–19 stay where they sit. */
function withWorking<T extends { spansWorks: boolean }>(items: T[], working: T[]): T[] {
  let next = 0;
  return items.map((item) => (item.spansWorks ? item : working[next++]!));
}

/**
 * A stored plan's rules as a chain. One made before the list's order set the
 * dates (each chapter said what it waited for, maybe from a fixed day) is put
 * in the order its chapters start on `dates` (its stored ones), each lag the
 * calendar days from the end of the one above, so it gives the same dates;
 * one already a chain is kept as it is.
 */
export function chainOf(items: PlanningItemInput[], dates: ReadonlyMap<string, Dates>): PlanningItemInput[] {
  const chained = chainRules(items);
  if (chained.every((rule, i) => rule.after === items[i]!.after && rule.lagDays === items[i]!.lagDays && items[i]!.fixedStart === null)) {
    return items;
  }
  const startOf = (item: PlanningItemInput) => dates.get(item.code)?.start ?? "";
  const working = items.filter((item) => !item.spansWorks).sort((a, b) => startOf(a).localeCompare(startOf(b)));
  let aboveEnd: string | null = null;
  const timed = working.map((item) => {
    const d = dates.get(item.code);
    const lag = aboveEnd && d ? daysBetween(aboveEnd, d.start) - 1 : 0;
    if (d) aboveEnd = d.end;
    return { ...item, lagDays: Math.max(-MAX_PLAN_LAG_DAYS, Math.min(MAX_PLAN_LAG_DAYS, lag)) };
  });
  return chainRules(withWorking(items, timed));
}

/**
 * `items` with the chapter `code` moved to where the chapter `toCode` is, the
 * ones between making room (one place up or down: `toCode` is its neighbour).
 * The chapters that span the works (shown apart) stay where they are; the same
 * array when either is one of them or unknown, or both are the same. The order
 * is the sequence (`chainRules`): moving a chapter moves the dates.
 */
export function moveChapter<T extends { code: string; spansWorks: boolean }>(items: T[], code: string, toCode: string): T[] {
  const working = items.filter((item) => !item.spansWorks);
  const from = working.findIndex((item) => item.code === code);
  const to = working.findIndex((item) => item.code === toCode);
  if (from < 0 || to < 0 || from === to) return items;
  working.splice(to, 0, ...working.splice(from, 1));
  return withWorking(items, working);
}

/** What is wrong with a draft's rules, or null: a chapter twice, or a length or lag out of range. */
export function planProblem(items: PlanningItemInput[]): "invalid_input" | null {
  if (new Set(items.map((item) => item.code)).size !== items.length) return "invalid_input";
  for (const item of items) {
    if (!Number.isInteger(item.durationDays) || item.durationDays < 1 || item.durationDays > MAX_PLAN_DURATION_DAYS) return "invalid_input";
    if (!Number.isInteger(item.lagDays) || Math.abs(item.lagDays) > MAX_PLAN_LAG_DAYS) return "invalid_input";
  }
  return null;
}

// ─── The standard plan ───────────────────────────────────────────────────────

type TemplateRule = { code: string; lagDays: number; durationDays: number };

/**
 * ViTAH's steel-frame house in the order its chapters start, each after the
 * one above it with its lag (calendar days, negative to overlap) and its
 * working days: about 180 in all. Staff adjust it per project.
 */
export const PLAN_TEMPLATE: readonly TemplateRule[] = [
  { code: "01", lagDays: 0, durationDays: 10 },
  { code: "02", lagDays: 0, durationDays: 25 },
  { code: "03", lagDays: 0, durationDays: 28 },
  { code: "05", lagDays: 0, durationDays: 15 },
  { code: "06", lagDays: -14, durationDays: 30 },
  { code: "04", lagDays: -28, durationDays: 30 },
  { code: "10", lagDays: -35, durationDays: 50 },
  { code: "11", lagDays: -35, durationDays: 15 },
  { code: "13", lagDays: -21, durationDays: 20 },
  { code: "14", lagDays: -21, durationDays: 15 },
  { code: "12", lagDays: -7, durationDays: 24 },
  { code: "07", lagDays: 0, durationDays: 20 },
  { code: "09", lagDays: -28, durationDays: 25 },
  { code: "08", lagDays: -21, durationDays: 19 },
  { code: "15", lagDays: -14, durationDays: 5 },
  { code: "16", lagDays: -7, durationDays: 13 },
];

/** A chapter the template doesn't know (a chosen option): two weeks, after the others. */
const UNKNOWN = { lagDays: 0, durationDays: 10 };

/** The standard plan for these chapter codes, in the template's order; the ones it doesn't know after them. */
export function templateItems(codes: string[]): PlanningItemInput[] {
  const known = new Set(PLAN_TEMPLATE.map((rule) => rule.code));
  const present = new Set(codes);
  const rule = (code: string, spansWorks: boolean, { lagDays, durationDays }: Omit<TemplateRule, "code">): PlanningItemInput => ({
    code,
    after: null,
    lagDays,
    durationDays,
    fixedStart: null,
    spansWorks,
  });
  return chainRules([
    ...PLAN_TEMPLATE.filter((r) => present.has(r.code)).map((r) => rule(r.code, false, r)),
    ...codes.filter((code) => !known.has(code) && !SPANS_WORKS.has(code)).map((code) => rule(code, false, UNKNOWN)),
    ...codes.filter((code) => SPANS_WORKS.has(code)).map((code) => rule(code, true, { lagDays: 0, durationDays: 1 })),
  ]);
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

export type Recorded = { actualStart: string | null; actualEnd: string | null };
export type Dates = { start: string; end: string };

/**
 * Each chapter's dates, from a chain (`chainRules`, or `chainOf` for a stored
 * plan). A chapter starts on the first working day from the day after the one
 * above it ends plus its lag (calendar days, negative to overlap; never before
 * the works' start), the first on the works' start, and lasts its working
 * days. What Avance recorded wins: a started chapter keeps its real start, a
 * finished one its real dates. With `today`, nothing still to happen is
 * placed in the past.
 */
export function schedulePlan(
  items: PlanningItemInput[],
  options: { startDate: string; calendar: PlanningCalendar; recorded?: ReadonlyMap<string, Recorded>; today?: string },
): Map<string, Dates> {
  const cal = workCalendar(options.calendar);
  const recorded = options.recorded ?? new Map<string, Recorded>();
  const byCode = new Map(items.map((item) => [item.code, item]));
  const worksStart = cal.nextWorkDay(options.startDate);
  const floor = options.today ? cal.nextWorkDay(options.today) : null;
  // What is still to happen, never before today.
  const notPast = (day: string) => (floor && day < floor ? floor : day);
  const dates = new Map<string, Dates>();

  const place = (item: PlanningItemInput): Dates => {
    const known = dates.get(item.code);
    if (known) return known;
    const actual = recorded.get(item.code);
    let start: string;
    if (actual?.actualStart) start = actual.actualStart;
    else {
      const before = item.after ? byCode.get(item.after) : undefined;
      const after = before && cal.nextWorkDay(addDays(place(before).end, 1 + item.lagDays));
      start = notPast(after && after > worksStart ? after : worksStart);
    }
    const end = actual?.actualEnd ?? notPast(cal.addWorkDays(cal.nextWorkDay(start), item.durationDays - 1));
    const result = { start, end };
    dates.set(item.code, result);
    return result;
  };

  for (const item of items) if (!item.spansWorks) place(item);
  const ends = [...dates.values()].map((d) => d.end).sort();
  const lastEnd = ends.at(-1) ?? worksStart;
  for (const item of items) {
    if (!item.spansWorks) continue;
    const actual = recorded.get(item.code);
    const start = actual?.actualStart ?? worksStart;
    const end = actual?.actualEnd ?? (lastEnd < start ? start : lastEnd);
    dates.set(item.code, { start, end });
  }
  return dates;
}

/** The plan's last day: its latest chapter end. */
export function planEnd(dates: ReadonlyMap<string, Dates>): string | null {
  return [...dates.values()].map((d) => d.end).sort().at(-1) ?? null;
}

/**
 * The works' dates the client is told: the approved plan's first start and
 * last end (the handover), else the project's own dates.
 */
export function clientDates(
  approved: ReadonlyMap<string, Dates> | null,
  project: { startDate: string | null; completionDate: string | null },
) {
  const start = approved ? [...approved.values()].map((d) => d.start).sort()[0] : undefined;
  return {
    startDate: start ?? project.startDate,
    completionDate: (approved && planEnd(approved)) ?? project.completionDate,
  };
}

/**
 * The chapters still to finish that set the end: from the latest-ending
 * chapter back through what each waits for.
 */
export function criticalPath(
  items: PlanningItemInput[],
  dates: ReadonlyMap<string, Dates>,
  recorded: ReadonlyMap<string, Recorded> = new Map(),
): Set<string> {
  const working = items.filter((item) => !item.spansWorks);
  const last = working.map((item) => dates.get(item.code)?.end ?? "").sort().at(-1);
  const critical = new Set<string>();
  if (!last) return critical;
  const byCode = new Map(working.map((item) => [item.code, item]));
  const visit = (item: PlanningItemInput | undefined) => {
    if (!item || critical.has(item.code) || recorded.get(item.code)?.actualEnd) return;
    critical.add(item.code);
    if (item.after) visit(byCode.get(item.after));
  };
  for (const item of working) if (dates.get(item.code)?.end === last) visit(item);
  return critical;
}

/** How a plan ending on `endDate` stands against the contract. */
export function planCheck(endDate: string, contractEnd: string | null): PlanningCheck {
  return { endDate, contractEnd, delayDays: contractEnd ? daysBetween(contractEnd, endDate) : null };
}
