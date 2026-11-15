import { describe, expect, it } from "vitest";
import { ATTENTION_FILTERS, byUrgency, matchesAttention, OBRA_FILTERS, obraFilterOf, type ProjectSignals } from "../src/contract";

describe("obraFilterOf", () => {
  it("puts stages 1–5 before the obra, 6 under construction and 7–8 past it", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(obraFilterOf)).toEqual([
      "not_started",
      "not_started",
      "not_started",
      "not_started",
      "not_started",
      "execution",
      "finished",
      "finished",
    ]);
  });

  it("offers every filter, all first", () => {
    expect(OBRA_FILTERS).toEqual(["all", "not_started", "execution", "finished"]);
  });
});

describe("the Atención filter", () => {
  const obra = (lateDays: number | null, kinds: number, count = kinds): Pick<ProjectSignals, "schedule" | "attention"> => ({
    schedule: lateDays === null ? { status: "on_time", worst: null, days: null } : { status: "late", worst: "start", days: lateDays },
    attention: Array.from({ length: kinds }, (_, i) => ({ kind: i === 0 ? "requests" : "documents", count: i === 0 ? count - kinds + 1 : 1 })),
  });

  it("takes the late obras and those with a reason; late, only the late ones", () => {
    expect(ATTENTION_FILTERS).toEqual(["all", "attention", "late"]);
    expect([obra(null, 0), obra(5, 0), obra(null, 1)].map((o) => matchesAttention("attention", o))).toEqual([false, true, true]);
    expect([obra(null, 0), obra(5, 0), obra(null, 1)].map((o) => matchesAttention("late", o))).toEqual([false, true, false]);
    expect(matchesAttention("all", obra(null, 0))).toBe(true);
    // Without a contract there is no schedule.
    expect(matchesAttention("late", { schedule: null, attention: [] })).toBe(false);
  });

  it("puts the late first, then the most kinds of reason, the most of them, the most days late", () => {
    const list = { a: obra(null, 1, 4), b: obra(2, 0), c: obra(null, 2), d: obra(9, 0), e: obra(null, 1, 1) };
    const sorted = Object.entries(list).sort(([, x], [, y]) => byUrgency(x, y)).map(([key]) => key);
    expect(sorted).toEqual(["d", "b", "c", "a", "e"]);
    expect(byUrgency(obra(null, 1), obra(null, 1))).toBe(0);
  });
});
