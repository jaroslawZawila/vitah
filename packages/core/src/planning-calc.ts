import type { PlanningCalendar, PlanningCheck, PlanningItemInput, PlanningRegion, PlanningRule } from "./contract";
import { addDays, delayPenaltyCents } from "./obra-calc";
import { daysBetween } from "./subcontractor-rules";

export { isCalendarDate } from "./calendar";

// ─── Planning arithmetic ─────────────────────────────────────────────────────
// Pure functions behind ./planning, also used by the portal to recompute a
// draft as staff type: the working calendar, the standard plan, each chapter's
// dates from what it waits for, the critical path and the check against the
// contract. No database.
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

// ─── The standard plan ───────────────────────────────────────────────────────

/** Quality control, health and safety and waste management run through the whole works. */
export const SPANS_WORKS = new Set(["17", "18", "19"]);

type TemplateRule = Omit<PlanningRule, "fixedStart" | "spansWorks">;

/** A chapter the template doesn't know: with the works, two weeks, ordered two weeks ahead. */
const UNKNOWN: TemplateRule = { after: null, lagDays: 0, durationDays: 10, leadDays: 14 };

/**
 * ViTAH's steel-frame house, by chapter code: what each waits for, how many
 * working days it takes (about 180 in all) and how many calendar days ahead
 * its orders go out (fabricated steel, Thermochip and the heat pump six weeks,
 * carpentry eight). Staff adjust it per project.
 */
export const PLAN_TEMPLATE: Record<string, TemplateRule> = {
  "01": { after: null, lagDays: 0, durationDays: 10, leadDays: 7 },
  "02": { after: "01", lagDays: 0, durationDays: 25, leadDays: 14 },
  "03": { after: "02", lagDays: 0, durationDays: 28, leadDays: 42 },
  "05": { after: "03", lagDays: 0, durationDays: 15, leadDays: 21 },
  "06": { after: "03", lagDays: 5, durationDays: 30, leadDays: 42 },
  "04": { after: "05", lagDays: 0, durationDays: 30, leadDays: 14 },
  "10": { after: "05", lagDays: 5, durationDays: 50, leadDays: 56 },
  "11": { after: "04", lagDays: 0, durationDays: 15, leadDays: 21 },
  "13": { after: "04", lagDays: 0, durationDays: 20, leadDays: 14 },
  "14": { after: "13", lagDays: -15, durationDays: 15, leadDays: 14 },
  "12": { after: "11", lagDays: 0, durationDays: 24, leadDays: 42 },
  "07": { after: "12", lagDays: 0, durationDays: 20, leadDays: 14 },
  "09": { after: "12", lagDays: 0, durationDays: 25, leadDays: 14 },
  "08": { after: "07", lagDays: -10, durationDays: 19, leadDays: 21 },
  "15": { after: "07", lagDays: 0, durationDays: 5, leadDays: 14 },
  "16": { after: "07", lagDays: 0, durationDays: 13, leadDays: 7 },
};

/** A chapter's standard lead time: what a project without its own plan orders by. */
export const templateLeadDays = (code: string) => (SPANS_WORKS.has(code) ? 0 : (PLAN_TEMPLATE[code] ?? UNKNOWN).leadDays);

/** The day a chapter starting on `start` must have its orders placed by. */
export const orderByDate = (start: string, leadDays: number) => addDays(start, -leadDays);

/** The standard plan for these chapter codes; a dependency on a chapter not in the contract is dropped. */
export function templateItems(codes: string[]): PlanningItemInput[] {
  const present = new Set(codes);
  return codes.map((code) => {
    if (SPANS_WORKS.has(code)) return { code, after: null, lagDays: 0, durationDays: 1, fixedStart: null, spansWorks: true, leadDays: 0 };
    const rule = PLAN_TEMPLATE[code] ?? UNKNOWN;
    const after = rule.after && present.has(rule.after) ? rule.after : null;
    return { code, ...rule, after, lagDays: after ? rule.lagDays : 0, fixedStart: null, spansWorks: false };
  });
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

export const MAX_DURATION_DAYS = 600;
export const MAX_LAG_DAYS = 250;
export const MAX_LEAD_DAYS = 365;

/** What is wrong with a set of rules, or null: a dependency on itself, on a missing or spanning chapter, or a cycle. */
export function planProblem(items: PlanningItemInput[]): "invalid_input" | "dependency_cycle" | null {
  const byCode = new Map(items.map((item) => [item.code, item]));
  if (byCode.size !== items.length) return "invalid_input";
  for (const item of items) {
    if (!Number.isInteger(item.durationDays) || item.durationDays < 1 || item.durationDays > MAX_DURATION_DAYS) return "invalid_input";
    if (!Number.isInteger(item.lagDays) || Math.abs(item.lagDays) > MAX_LAG_DAYS) return "invalid_input";
    if (!Number.isInteger(item.leadDays) || item.leadDays < 0 || item.leadDays > MAX_LEAD_DAYS) return "invalid_input";
    if (item.after === null) continue;
    const target = byCode.get(item.after);
    if (!target || target.code === item.code || target.spansWorks || item.spansWorks) return "invalid_input";
  }
  for (const item of items) {
    const seen = new Set<string>();
    for (let at: PlanningItemInput | undefined = item; at?.after; at = byCode.get(at.after)) {
      if (seen.has(at.code)) return "dependency_cycle";
      seen.add(at.code);
    }
  }
  return null;
}

export type Recorded = { actualStart: string | null; actualEnd: string | null };
export type Dates = { start: string; end: string };

/**
 * Each chapter's dates. A chapter starts the working day after the one it
 * waits for ends (plus its lag), else on its fixed day or the works' start,
 * and lasts its working days. What Avance recorded wins: a started chapter
 * keeps its real start, a finished one its real dates. With `today`, nothing
 * still to happen is placed in the past. The rules must pass `planProblem`.
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
      start = notPast(
        before ? cal.nextWorkDay(cal.addWorkDays(place(before).end, 1 + item.lagDays)) : cal.nextWorkDay(item.fixedStart ?? worksStart),
      );
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
export function planCheck(endDate: string, contractEnd: string | null, contractCents: number): PlanningCheck {
  const delayDays = contractEnd ? daysBetween(contractEnd, endDate) : null;
  return {
    endDate,
    contractEnd,
    delayDays,
    penaltyCents: delayDays === null ? 0 : delayPenaltyCents(delayDays, contractCents),
  };
}
