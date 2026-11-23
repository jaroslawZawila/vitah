import { describe, expect, it } from "vitest";
import type { PlanningCalendar, PlanningItemInput } from "../src/contract";
import {
  criticalPath,
  easterSunday,
  holidaysOf,
  moveChapter,
  orderByDate,
  planCheck,
  planEnd,
  planProblem,
  schedulePlan,
  templateItems,
  templateLeadDays,
  workCalendar,
  type Recorded,
} from "../src/planning-calc";

const PLAIN: PlanningCalendar = { region: null, augustClosure: false, christmasClosure: false };

const item = (code: string, after: string | null, durationDays: number, lagDays = 0, leadDays = 0): PlanningItemInput => ({
  code,
  after,
  lagDays,
  durationDays,
  fixedStart: null,
  spansWorks: false,
  leadDays,
});
const spanning = (code: string): PlanningItemInput => ({ ...item(code, null, 1), spansWorks: true });

/** 01 (5 d) → 02 (3 d) → 03 (2 d, overlapping 02's last day), and 17 through the works. */
const CHAIN = [item("01", null, 5), item("02", "01", 3), item("03", "02", 2, -1), spanning("17")];

const asObject = (dates: Map<string, { start: string; end: string }>) =>
  Object.fromEntries([...dates].map(([code, d]) => [code, `${d.start}…${d.end}`]));

describe("working calendar", () => {
  it("knows Easter and the national and regional holidays", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");

    const asturias = holidaysOf(2026, "as");
    expect(asturias.has("2026-04-02")).toBe(true); // Holy Thursday
    expect(asturias.has("2026-04-03")).toBe(true); // Good Friday
    expect(asturias.has("2026-09-08")).toBe(true); // Día de Asturias
    expect(asturias.has("2026-10-12")).toBe(true);

    const national = holidaysOf(2026, null);
    expect(national.has("2026-04-03")).toBe(true);
    expect(national.has("2026-04-02")).toBe(false);
    expect(national.has("2026-09-08")).toBe(false);
  });

  it("skips weekends, holidays and the closures chosen", () => {
    const cal = workCalendar(PLAIN);
    expect(cal.isWorkDay("2026-10-10")).toBe(false); // Saturday
    expect(cal.addWorkDays("2026-10-09", 1)).toBe("2026-10-13"); // Monday 12 is a holiday
    expect(cal.addWorkDays("2026-10-13", -1)).toBe("2026-10-09");
    expect(cal.addWorkDays("2026-10-13", 0)).toBe("2026-10-13");
    expect(cal.isWorkDay("2026-08-03")).toBe(true);

    const closed = workCalendar({ region: "as", augustClosure: true, christmasClosure: true });
    // August 2026 starts on a Saturday: four weeks off from Monday 3.
    expect(closed.nextWorkDay("2026-08-03")).toBe("2026-08-31");
    expect(closed.isWorkDay("2026-12-28")).toBe(false);
    expect(closed.nextWorkDay("2026-12-24")).toBe("2027-01-07");
  });
});

describe("templateItems", () => {
  it("gives each contract chapter the standard rule, dropping dependencies on missing chapters", () => {
    expect(templateItems(["01", "02", "17", "99"])).toEqual([
      item("01", null, 10, 0, 7),
      item("02", "01", 25, 0, 14),
      spanning("17"),
      item("99", null, 10, 0, 14),
    ]);
    // Without 01, cimentación starts with the works.
    expect(templateItems(["02"])[0]).toMatchObject({ code: "02", after: null, lagDays: 0 });
    expect(planProblem(templateItems(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19"]))).toBeNull();
  });
});

describe("moveChapter", () => {
  const codes = (items: PlanningItemInput[]) => items.map((i) => i.code);

  it("moves a chapter one place up or down, whole, and leaves the rest as they were", () => {
    const down = moveChapter(CHAIN, "01", "02");
    expect(codes(down)).toEqual(["02", "01", "03", "17"]);
    expect(down[1]).toBe(CHAIN[0]);
    expect(codes(moveChapter(CHAIN, "03", "02"))).toEqual(["01", "03", "02", "17"]);
    // The array given is never changed.
    expect(codes(CHAIN)).toEqual(["01", "02", "03", "17"]);
  });

  it("moves a chapter several places at once, the ones between making room", () => {
    const five = [item("01", null, 1), item("02", null, 1), item("03", null, 1), item("04", null, 1), item("05", null, 1)];
    expect(codes(moveChapter(five, "05", "02"))).toEqual(["01", "05", "02", "03", "04"]);
    expect(codes(moveChapter(five, "01", "04"))).toEqual(["02", "03", "04", "01", "05"]);
  });

  it("stays put on itself, for a chapter that spans the works and for one it doesn't know", () => {
    expect(moveChapter(CHAIN, "01", "01")).toBe(CHAIN);
    expect(moveChapter(CHAIN, "17", "01")).toBe(CHAIN);
    expect(moveChapter(CHAIN, "01", "17")).toBe(CHAIN);
    expect(moveChapter(CHAIN, "99", "01")).toBe(CHAIN);
  });

  it("leaves the chapters that span the works where they sit", () => {
    const mixed = [item("01", null, 5), spanning("17"), item("02", null, 5), spanning("18"), item("OP1", null, 3)];
    expect(codes(moveChapter(mixed, "01", "OP1"))).toEqual(["02", "17", "OP1", "18", "01"]);
    expect(codes(moveChapter(mixed, "OP1", "01"))).toEqual(["OP1", "17", "01", "18", "02"]);
  });

  it("changes no date: the order is only how the plan reads", () => {
    const options = { startDate: "2026-06-01", calendar: PLAIN };
    expect(asObject(schedulePlan(moveChapter(CHAIN, "03", "01"), options))).toEqual(asObject(schedulePlan(CHAIN, options)));
  });
});

describe("lead times", () => {
  it("gives each chapter its standard lead time and the day its orders must go out", () => {
    expect([templateLeadDays("03"), templateLeadDays("10"), templateLeadDays("17"), templateLeadDays("99")]).toEqual([42, 56, 0, 14]);
    expect(orderByDate("2026-12-07", 42)).toBe("2026-10-26");
    expect(planProblem([item("01", null, 5, 0, 366)])).toBe("invalid_input");
    expect(planProblem([item("01", null, 5, 0, -1)])).toBe("invalid_input");
  });
});

describe("planProblem", () => {
  it("accepts a chain and refuses cycles, self and missing dependencies, and bad numbers", () => {
    expect(planProblem(CHAIN)).toBeNull();
    expect(planProblem([item("01", "02", 1), item("02", "01", 1)])).toBe("dependency_cycle");
    expect(planProblem([item("01", "01", 1)])).toBe("invalid_input");
    expect(planProblem([item("01", "99", 1)])).toBe("invalid_input");
    expect(planProblem([item("01", "17", 1), spanning("17")])).toBe("invalid_input");
    expect(planProblem([item("01", null, 0)])).toBe("invalid_input");
    expect(planProblem([item("01", null, 1), item("01", null, 2)])).toBe("invalid_input");
  });
});

describe("schedulePlan", () => {
  it("chains the chapters in working days, overlapping with a negative lag", () => {
    const dates = schedulePlan(CHAIN, { startDate: "2026-06-01", calendar: PLAIN });
    expect(asObject(dates)).toEqual({
      "01": "2026-06-01…2026-06-05",
      "02": "2026-06-08…2026-06-10",
      "03": "2026-06-10…2026-06-11",
      "17": "2026-06-01…2026-06-11",
    });
    expect(planEnd(dates)).toBe("2026-06-11");
  });

  it("starts a chapter on its fixed day, or the next working one", () => {
    const fixed = { ...item("09", null, 2), fixedStart: "2026-06-06" };
    expect(asObject(schedulePlan([fixed], { startDate: "2026-06-01", calendar: PLAIN }))).toEqual({
      "09": "2026-06-08…2026-06-09",
    });
  });

  it("follows what Avance recorded and pushes what waits for it", () => {
    const recorded = new Map<string, Recorded>([["01", { actualStart: "2026-06-01", actualEnd: "2026-06-09" }]]);
    const dates = schedulePlan(CHAIN, { startDate: "2026-06-01", calendar: PLAIN, recorded });
    expect(asObject(dates)).toMatchObject({
      "01": "2026-06-01…2026-06-09",
      "02": "2026-06-10…2026-06-12",
      "03": "2026-06-12…2026-06-15",
    });
  });

  it("places nothing still to happen before today", () => {
    const recorded = new Map<string, Recorded>([
      ["01", { actualStart: "2026-06-01", actualEnd: "2026-06-09" }],
      ["02", { actualStart: "2026-06-10", actualEnd: null }],
    ]);
    // Saturday 20 June: the next working day is Monday 22.
    const dates = schedulePlan(CHAIN, { startDate: "2026-06-01", calendar: PLAIN, recorded, today: "2026-06-20" });
    expect(asObject(dates)).toMatchObject({
      "02": "2026-06-10…2026-06-22",
      "03": "2026-06-22…2026-06-23",
      "17": "2026-06-01…2026-06-23",
    });
  });
});

describe("criticalPath", () => {
  it("follows the latest-ending chapter back, leaving finished ones and side branches out", () => {
    const items = [...CHAIN, item("04", "01", 1)];
    const dates = schedulePlan(items, { startDate: "2026-06-01", calendar: PLAIN });
    expect([...criticalPath(items, dates)].sort()).toEqual(["01", "02", "03"]);

    const recorded = new Map<string, Recorded>([["01", { actualStart: "2026-06-01", actualEnd: "2026-06-05" }]]);
    expect([...criticalPath(items, dates, recorded)].sort()).toEqual(["02", "03"]);
  });
});

describe("planCheck", () => {
  it("measures the end against the contract, in days and nothing more", () => {
    expect(planCheck("2026-12-23", "2026-12-18")).toEqual({ endDate: "2026-12-23", contractEnd: "2026-12-18", delayDays: 5 });
    expect(planCheck("2027-01-10", "2026-12-18")).toEqual({ endDate: "2027-01-10", contractEnd: "2026-12-18", delayDays: 23 });
    expect(planCheck("2026-12-01", "2026-12-18").delayDays).toBe(-17);
    expect(planCheck("2026-12-01", null)).toEqual({ endDate: "2026-12-01", contractEnd: null, delayDays: null });
  });
});
