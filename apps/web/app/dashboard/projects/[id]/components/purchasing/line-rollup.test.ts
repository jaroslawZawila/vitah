import { describe, expect, it } from "vitest";
import { lines } from "../../../../../../test/invoice-fixture";
import { rollUpLines } from "./line-rollup";

const all = lines.chapters.flatMap((c) => c.lines);
const sum = (key: "costCents" | "contractedCents" | "invoicedCents" | "paidCents") =>
  all.reduce((total, line) => total + line[key], 0);

describe("rollUpLines", () => {
  it("adds up each chapter's lines as core totals the chapter", () => {
    for (const chapter of lines.chapters) {
      const rollup = rollUpLines(chapter.lines);
      expect(rollup).toMatchObject({
        lines: chapter.lines.length,
        costCents: chapter.costCents,
        contractedCents: chapter.contractedCents,
        deviationCents: chapter.deviationCents,
      });
    }
  });

  it("adds up the whole obra to the figures each line shows, and to the obra's summary", () => {
    const rollup = rollUpLines(all);
    expect(rollup).toEqual({
      lines: 3,
      costCents: sum("costCents"),
      contractedCents: sum("contractedCents"),
      deviationCents: 8_000 + 700_000,
      closedLines: 2,
      invoicedCents: sum("invoicedCents"),
      paidCents: sum("paidCents"),
      counts: lines.counts,
      overdue: 1,
      lateOrders: 0,
    });
    // (The fixture's summary deviation is made up; on the seeded obra core's equals the lines' sum.)
    expect(rollup).toMatchObject({
      costCents: lines.summary.costCents,
      contractedCents: lines.summary.contractedCents,
      closedLines: lines.summary.closedLines,
      invoicedCents: lines.summary.invoicedCents,
      paidCents: lines.summary.paidCents,
    });
  });

  it("leaves the deviation empty while no line is closed, and counts a late order once", () => {
    const line = lines.chapters[2]!.lines[0]!;
    const order = { ...lines.chapters[1]!.lines[0]!.orders[0]!, id: "late", lateDays: 4 };
    const rollup = rollUpLines([
      { ...line, orders: [order] },
      { ...line, lineageId: "other", orders: [order] },
    ]);
    expect(rollup.deviationCents).toBeNull();
    expect(rollup.closedLines).toBe(0);
    expect(rollup.lateOrders).toBe(1);
    expect(rollup.counts).toEqual({ to_contract: 2, contracted: 0, invoiced: 0, paid: 0 });
    expect(rollUpLines([])).toMatchObject({ lines: 0, costCents: 0, deviationCents: null });
  });
});
