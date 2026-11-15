import { contractTotals } from "@repo/core/control-calc";
import type { CostLine } from "@repo/core/contract";
import { describe, expect, it } from "vitest";
import { costs } from "../../../../../../test/construction-fixture";
import { rollUpCosts } from "./cost-rollup";

/** Core's totals for the same lines (as `getProjectPurchases` sums a chapter). */
const coreTotals = (lines: CostLine[]) =>
  contractTotals(
    lines.map((line) => ({ lineageId: line.id, amountCents: line.costCents })),
    new Map(
      lines
        .filter((line) => line.contractedCents !== null)
        .map((line) => [line.id, { contractedCents: line.contractedCents!, closed: line.contracting === "closed" }]),
    ),
  );

describe("rollUpCosts", () => {
  it("adds up a chapter to the figures its lines show", () => {
    const envelope = costs.chapters[0]!.lines;
    expect(rollUpCosts(envelope)).toEqual({
      lines: 5,
      costCents: 1_260_000 + 116_928 + 332_400 + 171_000 + 145_000,
      contractedCents: 1_215_000 + 124_000 + 352_000 + 90_000,
      deviationCents: -45_000 + 7_072 + 19_600,
      deviationBp: Math.round((-18_328 * 10_000) / (1_260_000 + 116_928 + 332_400)),
      closed: 3,
      open: 1,
      overruns: 2,
      lateOrders: 1,
    });
  });

  it("agrees with core's contract totals, chapter by chapter and for the whole obra", () => {
    for (const lines of [...costs.chapters.map((c) => c.lines), costs.chapters.flatMap((c) => c.lines)]) {
      const rollup = rollUpCosts(lines);
      const core = coreTotals(lines);
      expect(rollup.contractedCents ?? 0).toBe(core.contractedCents);
      expect(rollup.closed).toBe(core.closedLines);
      expect(rollup.open).toBe(core.openLines);
      expect(rollup.deviationCents).toBe(core.deviationCents);
      expect(rollup.deviationBp).toBe(core.deviationBp);
    }
  });

  it("shows no zero for what nothing is contracted for, and counts a late order once", () => {
    const [line] = costs.chapters[0]!.lines.filter((l) => l.contracting === "none");
    expect(rollUpCosts([line!])).toMatchObject({ contractedCents: null, deviationCents: null, deviationBp: null });
    const late = costs.chapters[0]!.lines.find((l) => l.code === "06.05")!;
    expect(rollUpCosts([late, { ...late, id: "copy" }]).lateOrders).toBe(1);
    expect(rollUpCosts([])).toMatchObject({ lines: 0, costCents: 0, contractedCents: null });
  });
});
