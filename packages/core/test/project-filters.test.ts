import { describe, expect, it } from "vitest";
import { OBRA_FILTERS, obraFilterOf } from "../src/contract";

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
