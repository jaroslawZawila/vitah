import { describe, expect, it } from "vitest";
import { projectSchedule, scheduleStatus, type ScheduleChapterInput } from "../src/contract";
import { planCheck } from "../src/planning-calc";

const TODAY = "2026-10-20";
const CONTRACT_CENTS = 30_000_000;

const chapter = (code: string, state: ScheduleChapterInput["state"], plannedStart: string | null, plannedEnd: string | null) => ({
  code,
  name: `Capítulo ${code}`,
  state,
  plannedStart,
  plannedEnd,
});

/** On plan: 01 finished, 02 in progress until the 30th, 03 starting next month. */
const onPlan = [
  chapter("01", "finished", "2026-09-01", "2026-09-30"),
  chapter("02", "in_progress", "2026-10-01", "2026-10-30"),
  chapter("03", "pending", "2026-11-02", "2026-11-30"),
];
const forecastOnTime = planCheck("2027-03-01", "2027-03-31", CONTRACT_CENTS);

describe("scheduleStatus", () => {
  it("is on time with a baseline only when nothing contradicts it", () => {
    expect(scheduleStatus({ chapters: onPlan, planning: "live", forecast: forecastOnTime, today: TODAY })).toEqual({
      status: "on_time",
      planning: "live",
      forecast: forecastOnTime,
      lateToStart: [],
      lateToFinish: [],
      worst: null,
    });
  });

  it("is late when a chapter's planned start has passed and it hasn't started", () => {
    // The finding: the summary used to look at chapters in progress only.
    const chapters = [...onPlan.slice(0, 2), chapter("17", "pending", "2026-02-13", "2027-03-01")];
    const status = scheduleStatus({ chapters, planning: "live", forecast: forecastOnTime, today: TODAY });
    expect(status).toMatchObject({
      status: "late",
      worst: "start",
      lateToFinish: [],
      lateToStart: [{ code: "17", name: "Capítulo 17", plannedDate: "2026-02-13", days: 249 }],
    });
  });

  it("is late when a chapter in progress is past its planned end", () => {
    const chapters = [chapter("02", "in_progress", "2026-09-01", "2026-10-15"), onPlan[2]!];
    const status = scheduleStatus({ chapters, planning: "live", forecast: forecastOnTime, today: TODAY });
    expect(status).toMatchObject({
      status: "late",
      worst: "finish",
      lateToStart: [],
      lateToFinish: [{ code: "02", plannedDate: "2026-10-15", days: 5 }],
    });
  });

  it("is late when the forecast ends after the contract, and leads with it", () => {
    const forecast = planCheck("2027-07-10", "2027-03-31", CONTRACT_CENTS);
    expect(forecast).toMatchObject({ delayDays: 101, penaltyCents: 1_305_000 });
    const chapters = [...onPlan.slice(0, 2), chapter("17", "pending", "2026-02-13", "2027-03-01")];
    const status = scheduleStatus({ chapters, planning: "live", forecast, today: TODAY });
    expect(status).toMatchObject({ status: "late", worst: "forecast", forecast, lateToStart: [{ code: "17" }] });
    // Late from the forecast alone, every chapter on plan.
    expect(scheduleStatus({ chapters: onPlan, planning: "live", forecast, today: TODAY })).toMatchObject({
      status: "late",
      worst: "forecast",
    });
  });

  it("counts every late chapter, most days first, and leads with the one most behind", () => {
    const chapters = [
      chapter("04", "pending", "2026-10-10", "2026-11-10"),
      chapter("05", "in_progress", "2026-09-01", "2026-10-05"),
      chapter("06", "pending", "2026-10-01", "2026-11-10"),
      chapter("07", "in_progress", "2026-09-01", "2026-10-18"),
    ];
    const status = scheduleStatus({ chapters, planning: "live", forecast: forecastOnTime, today: TODAY });
    expect(status.lateToStart.map((c) => [c.code, c.days])).toEqual([
      ["06", 19],
      ["04", 10],
    ]);
    expect(status.lateToFinish.map((c) => [c.code, c.days])).toEqual([
      ["05", 15],
      ["07", 2],
    ]);
    expect(status.worst).toBe("start");
    // On a tie, the chapter that should have finished leads.
    const tie = scheduleStatus({
      chapters: [chapter("04", "pending", "2026-10-10", "2026-11-10"), chapter("05", "in_progress", "2026-09-01", "2026-10-10")],
      planning: "live",
      forecast: forecastOnTime,
      today: TODAY,
    });
    expect(tie.worst).toBe("finish");
  });

  it("doesn't count a planned date that is today, a finished chapter, or a forecast ending on the contract's day", () => {
    const chapters = [
      chapter("01", "finished", "2026-09-01", "2026-09-30"),
      chapter("02", "in_progress", "2026-10-01", TODAY),
      chapter("03", "pending", TODAY, "2026-11-30"),
    ];
    const forecast = planCheck("2027-03-31", "2027-03-31", CONTRACT_CENTS);
    expect(scheduleStatus({ chapters, planning: "live", forecast, today: TODAY })).toMatchObject({ status: "on_time", worst: null });
  });

  it("can't compare with the contract without its date, but still sees late chapters", () => {
    const forecast = planCheck("2027-07-10", null, CONTRACT_CENTS);
    expect(scheduleStatus({ chapters: onPlan, planning: "live", forecast, today: TODAY })).toMatchObject({
      status: "on_time",
      forecast: { contractEnd: null, delayDays: null },
    });
    const chapters = [chapter("03", "pending", "2026-10-01", "2026-11-30")];
    expect(scheduleStatus({ chapters, planning: "live", forecast, today: TODAY })).toMatchObject({ status: "late", worst: "start" });
  });

  it("never says on time or late on simulated dates, but lists what runs behind them", () => {
    const onTime = scheduleStatus({ chapters: onPlan, planning: "mock", forecast: null, today: TODAY });
    expect(onTime).toMatchObject({ status: "simulated", planning: "mock", forecast: null, worst: null });
    const behind = scheduleStatus({
      chapters: [chapter("17", "pending", "2026-02-13", "2027-03-01")],
      planning: "mock",
      // A forecast is the baseline's: without one it is ignored.
      forecast: planCheck("2027-07-10", "2027-03-31", CONTRACT_CENTS),
      today: TODAY,
    });
    expect(behind).toMatchObject({ status: "simulated", forecast: null, worst: "start", lateToStart: [{ code: "17", days: 249 }] });
  });

  it("has nothing to say without any dates", () => {
    const undated = [chapter("01", "pending", null, null), chapter("02", "in_progress", null, null)];
    expect(scheduleStatus({ chapters: undated, planning: "mock", forecast: null, today: TODAY })).toMatchObject({
      status: "no_dates",
      worst: null,
    });
    expect(scheduleStatus({ chapters: [], planning: "mock", forecast: null, today: TODAY }).status).toBe("no_dates");
    // A baseline whose chapters all left the contract: still nothing to measure.
    expect(scheduleStatus({ chapters: undated, planning: "live", forecast: null, today: TODAY }).status).toBe("no_dates");
  });
});

describe("projectSchedule", () => {
  it("keeps the verdict and, when late, the days of what it leads with", () => {
    const behind = [chapter("01", "in_progress", "2026-09-01", "2026-10-10"), chapter("02", "pending", "2026-10-15", "2026-11-30")];
    expect(projectSchedule(scheduleStatus({ chapters: behind, planning: "live", forecast: forecastOnTime, today: TODAY }))).toEqual({
      status: "late",
      worst: "finish",
      days: 10,
    });
    const overContract = planCheck("2027-04-30", "2027-03-31", CONTRACT_CENTS);
    expect(projectSchedule(scheduleStatus({ chapters: onPlan, planning: "live", forecast: overContract, today: TODAY }))).toEqual({
      status: "late",
      worst: "forecast",
      days: 30,
    });
    expect(projectSchedule(scheduleStatus({ chapters: onPlan, planning: "live", forecast: forecastOnTime, today: TODAY }))).toEqual({
      status: "on_time",
      worst: null,
      days: null,
    });
    // Simulated dates assert nothing: no days, whatever is behind them.
    expect(projectSchedule(scheduleStatus({ chapters: behind, planning: "mock", forecast: null, today: TODAY }))).toMatchObject({
      status: "simulated",
      days: null,
    });
  });
});
