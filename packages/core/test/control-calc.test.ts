import { describe, expect, it } from "vitest";
import {
  chapterState,
  chapterTiming,
  daysBetween,
  deviation,
  milestoneState,
  plannedDates,
  spanDays,
} from "../src/control-calc";

describe("chapterState", () => {
  it("follows only the recorded dates", () => {
    expect(chapterState(undefined)).toBe("pending");
    expect(chapterState({ actualStart: null, actualEnd: null })).toBe("pending");
    expect(chapterState({ actualStart: "2026-09-21", actualEnd: null })).toBe("in_progress");
    expect(chapterState({ actualStart: "2026-09-21", actualEnd: "2026-10-17" })).toBe("finished");
  });
});

describe("chapterTiming", () => {
  const plan = { start: "2026-09-14", end: "2026-10-09" };

  it("compares the actual dates with the plan", () => {
    expect(chapterTiming({ actualStart: "2026-09-21", actualEnd: "2026-10-17" }, plan, "2026-10-20")).toEqual({
      state: "finished",
      startDelayDays: 7,
      endDelayDays: 8,
      overdueDays: null,
      plannedDays: 26,
      actualDays: 27,
    });
  });

  it("shows an open chapter past its planned end as overdue, counting its days so far", () => {
    expect(chapterTiming({ actualStart: "2026-09-21", actualEnd: null }, plan, "2026-10-17")).toMatchObject({
      state: "in_progress",
      overdueDays: 8,
      actualDays: 27,
    });
    expect(chapterTiming({ actualStart: "2026-09-21", actualEnd: null }, plan, "2026-10-01").overdueDays).toBeNull();
  });

  it("has nothing to compare without a plan or dates", () => {
    expect(chapterTiming(undefined, undefined, "2026-10-17")).toEqual({
      state: "pending",
      startDelayDays: null,
      endDelayDays: null,
      overdueDays: null,
      plannedDays: null,
      actualDays: null,
    });
  });

  it("counts days", () => {
    expect(daysBetween("2026-09-30", "2026-10-01")).toBe(1);
    expect(spanDays("2026-06-01", "2026-06-16")).toBe(16);
  });
});

describe("milestoneState", () => {
  const base = { chapterStates: ["finished", "in_progress"] as const, requested: false, invoicedOn: null, paidOn: null };

  it("goes pending → reached → requested → invoiced → collected", () => {
    expect(milestoneState({ ...base, chapterStates: [...base.chapterStates] })).toBe("pending");
    expect(milestoneState({ ...base, chapterStates: ["finished", "finished"] })).toBe("reached");
    expect(milestoneState({ ...base, chapterStates: ["finished"], requested: true })).toBe("requested");
    expect(milestoneState({ ...base, chapterStates: [], invoicedOn: "2026-09-25" })).toBe("invoiced");
    // Only a payment collects it, not the invoice.
    expect(milestoneState({ ...base, chapterStates: [], invoicedOn: "2026-09-25", paidOn: "2026-10-01" })).toBe("collected");
  });

  it("is never reached without chapters", () => {
    expect(milestoneState({ ...base, chapterStates: [] })).toBe("pending");
  });
});

describe("plannedDates", () => {
  const works = { startDate: "2026-06-01", completionDate: "2027-03-31" };

  it("gives each hito a share of the time like its share of the price, in order", () => {
    const plan = plannedDates(
      works,
      [
        { pctBp: 500, chapterCodes: [] },
        { pctBp: 1000, chapterCodes: ["01", "02"] },
        { pctBp: 3000, chapterCodes: ["03"] },
        { pctBp: 1000, chapterCodes: ["04", "17"] },
      ],
      ["01", "02", "03", "04", "17", "21"],
    );
    expect(plan.get("01")).toEqual({ start: "2026-06-01", end: "2026-07-30" });
    expect(plan.get("02")).toEqual(plan.get("01"));
    expect(plan.get("03")).toEqual({ start: "2026-07-31", end: "2027-01-29" });
    expect(plan.get("04")).toEqual({ start: "2027-01-30", end: "2027-03-31" });
    // Quality, safety and waste, and chapters without a hito, run through the works.
    expect(plan.get("17")).toEqual({ start: "2026-06-01", end: "2027-03-31" });
    expect(plan.get("21")).toEqual({ start: "2026-06-01", end: "2027-03-31" });
  });

  it("plans nothing without the project's dates", () => {
    expect(plannedDates({ startDate: null, completionDate: "2027-03-31" }, [], ["01"]).size).toBe(0);
  });
});

describe("deviation", () => {
  it("is contracted minus cost: an overrun is positive, a saving negative", () => {
    expect(deviation(1_260_000, 1_215_000)).toEqual({ deviationCents: -45_000, deviationBp: -357 });
    expect(deviation(116_928, 124_000)).toEqual({ deviationCents: 7_072, deviationBp: 605 });
    expect(deviation(1000, null)).toEqual({ deviationCents: null, deviationBp: null });
  });
});
