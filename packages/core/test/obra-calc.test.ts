import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  buildPhases,
  forClient,
  hitoStatus,
  obraTerm,
  marginsOn,
  priceLines,
  progressOf,
  todayInSpain,
  unitCost,
  unitPrice,
  withPrices,
} from "../src/obra-calc";
import { lineAmountCents, type BudgetLine, type BudgetRevision, type Hito } from "../src/contract";

describe("lineAmountCents", () => {
  it("multiplies quantity by unit price, to the cent", () => {
    expect(lineAmountCents(265, 350)).toBe(92_750);
    expect(lineAmountCents(219.76, 800)).toBe(175_808);
    expect(lineAmountCents(604.56, 920)).toBe(556_195); // 5.561,952 → 5.561,95
    expect(lineAmountCents(0, 1_000)).toBe(0);
  });
});

describe("margins", () => {
  const margins = { overheadBp: 1300, profitBp: 600 };
  const line = (quantity: number, unitPriceCents: number) => ({ quantity, unitPriceCents, amountCents: lineAmountCents(quantity, unitPriceCents) });

  it("puts both margins in a unit price, to the cent: gastos on the cost, beneficio on the price", () => {
    expect(unitPrice(1_000, margins)).toBe(1_202); // 1.000 × 1,13 ÷ 0,94 = 1.202,13
    expect(unitPrice(322, margins)).toBe(387); // 387,09
    expect(unitPrice(-1_000, margins)).toBe(-1_202);
    expect(unitPrice(500, { overheadBp: 0, profitBp: 0 })).toBe(500);
    expect(unitPrice(0, margins)).toBe(0);
    expect(unitPrice(1_000, { overheadBp: 1300 } as typeof margins)).toBeNaN(); // a missing margin shows, never 0 €
  });

  it("follows Formulas_margen_obra: 15 % recargo on 100.000 € is 115.000 €, a 15 % margen 117.647,06 €", () => {
    expect(unitPrice(10_000_000, { overheadBp: 1500, profitBp: 0 })).toBe(11_500_000);
    expect(unitPrice(10_000_000, { overheadBp: 0, profitBp: 1500 })).toBe(11_764_706);
  });

  it("finds the unit cost that comes back to a price", () => {
    expect(unitCost(1_202, margins)).toBe(1_000);
    expect(unitCost(-1_202, margins)).toBe(-1_000);
    // 3,84 € can't be reached exactly (3,19 → 3,83 €, 3,20 → 3,85 €): a tie keeps the first guess.
    expect(unitPrice(unitCost(384, margins), margins)).toBe(383);
  });

  it("rounds halves away from zero, as linesPriceSql does", () => {
    const half = { overheadBp: 5000, profitBp: 0 }; // × 1,5: 1 → 1,5 and −1 → −1,5
    expect(unitPrice(1, half)).toBe(2);
    expect(unitPrice(-1, half)).toBe(-2);
  });

  it("prices lines so each is its quantity × its unit price", () => {
    const priced = priceLines([line(400, 322), line(1, 66_176)], margins);
    expect(priced.map((l) => [l.unitPriceCents, l.amountCents])).toEqual([
      [387, 154_800],
      [79_552, 79_552],
    ]);
    expect(priceLines([], margins)).toEqual([]);
  });

  it("prices chapters and options as the sum of their priced lines", () => {
    const [chapter, option] = withPrices(
      [{ lines: [line(400, 322), line(1, 66_176)] as BudgetLine[] }, { lines: [line(1, -100_000)] as BudgetLine[] }],
      margins,
    );
    expect(chapter!.priceCents).toBe(154_800 + 79_552);
    expect(option!.priceCents).toBe(-120_213);
  });

  it("splits what the margins came to: beneficio is its % of the price, gastos the rest", () => {
    expect(marginsOn(1_000_000, 1_202_131, margins)).toEqual({ overheadCents: 130_003, profitCents: 72_128 });
    expect(marginsOn(1_000_000, 1_064_000, { overheadBp: 0, profitBp: 600 })).toEqual({ overheadCents: 0, profitCents: 64_000 });
    expect(marginsOn(1_000_000, 1_130_000, { overheadBp: 1300, profitBp: 0 })).toEqual({ overheadCents: 130_000, profitCents: 0 });
    expect(marginsOn(1_000, 1_000, { overheadBp: 0, profitBp: 0 })).toEqual({ overheadCents: 0, profitCents: 0 });
  });

  it("gives the client's view of a revision: chapters and options at their price, lines priced", () => {
    const revision = {
      ...margins,
      chapters: [{ totalCents: 1_000, priceCents: 1_202, lines: [line(1, 1_000)] }],
      options: [{ totalCents: -1_000, priceCents: -1_202, lines: [line(2, -500)] }],
    } as unknown as BudgetRevision;
    const client = forClient(revision);
    expect(client.chapters[0]).toMatchObject({ totalCents: 1_202, lines: [{ amountCents: 1_202, unitPriceCents: 1_202 }] });
    expect(client.options[0]).toMatchObject({ totalCents: -1_202, lines: [{ amountCents: -1_202, unitPriceCents: -601 }] });
  });
});

describe("addBusinessDays", () => {
  it("skips weekends", () => {
    // Thu 24 Sept 2026 + 5 business days → Thu 1 Oct.
    expect(addBusinessDays("2026-09-24", 5)).toBe("2026-10-01");
    // Fri + 1 → Mon.
    expect(addBusinessDays("2026-09-25", 1)).toBe("2026-09-28");
    // Sat + 1 → Mon.
    expect(addBusinessDays("2026-09-26", 1)).toBe("2026-09-28");
  });
});

describe("todayInSpain", () => {
  it("is the calendar date in Madrid", () => {
    // 23:30 UTC on 30 Sept is already 1 Oct in Madrid (UTC+2).
    expect(todayInSpain(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10-01");
  });
});

describe("progressOf", () => {
  it("weights lines by amount", () => {
    const p = progressOf([
      { amountCents: 3_000, executedPct: 100 },
      { amountCents: 1_000, executedPct: 50 },
    ]);
    expect(p).toEqual({ totalCents: 4_000, executedCents: 3_500, progressPct: 88, status: "active" });
  });

  it("is done only when every line is at 100 %", () => {
    expect(progressOf([{ amountCents: 100, executedPct: 100 }]).status).toBe("done");
    // 99,95 % shows as 99 %, not 100 %, until the last line is done.
    const almost = progressOf([
      { amountCents: 1_999, executedPct: 100 },
      { amountCents: 1, executedPct: 0 },
    ]);
    expect(almost).toMatchObject({ progressPct: 99, status: "active" });
  });

  it("doesn't wait on a chosen deduction: the owner's works aren't built, the credit follows the rest", () => {
    const lines = (pct: number) => [
      { amountCents: 10_000, executedPct: pct },
      { amountCents: -2_000, executedPct: 0 },
    ];
    expect(progressOf(lines(0))).toEqual({ totalCents: 8_000, executedCents: 0, progressPct: 0, status: "pending" });
    expect(progressOf(lines(50))).toEqual({ totalCents: 8_000, executedCents: 4_000, progressPct: 50, status: "active" });
    expect(progressOf(lines(100))).toEqual({ totalCents: 8_000, executedCents: 8_000, progressPct: 100, status: "done" });
    // A deduction's own chapter has nothing to build.
    expect(progressOf([{ amountCents: -2_000, executedPct: 0 }])).toMatchObject({ executedCents: -2_000, status: "done" });
  });

  it("is pending with no progress or no lines", () => {
    expect(progressOf([{ amountCents: 100, executedPct: 0 }]).status).toBe("pending");
    expect(progressOf([])).toEqual({ totalCents: 0, executedCents: 0, progressPct: 0, status: "pending" });
  });
});

describe("obraTerm", () => {
  const total = 44_820_505; // 448.205,05 €

  it("counts the week of the works", () => {
    expect(obraTerm("2026-05-04", "2027-02-05", "2026-09-27", total)).toEqual({
      startDate: "2026-05-04",
      completionDate: "2027-02-05",
      week: 21,
      totalWeeks: 40,
      lateDays: 0,
      penaltyCents: 0,
    });
    expect(obraTerm("2026-05-04", "2027-02-05", "2026-05-04", total).week).toBe(1);
    expect(obraTerm("2026-05-04", "2027-02-05", "2026-04-30", total).week).toBe(0);
  });

  it("charges 150 € a day from the 15th day late, up to 5 % of the price", () => {
    const late = (days: number) => {
      const today = addDays("2027-02-05", days);
      return obraTerm("2026-05-04", "2027-02-05", today, total);
    };
    expect(late(14)).toMatchObject({ lateDays: 14, penaltyCents: 0 });
    expect(late(15)).toMatchObject({ lateDays: 15, penaltyCents: 15_000 });
    expect(late(20)).toMatchObject({ penaltyCents: 6 * 15_000 });
    expect(late(400).penaltyCents).toBe(Math.round(total * 0.05));
  });
});

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("hitoStatus", () => {
  const base = {
    chapterCount: 1,
    readyPct: 100,
    checks: [{ done: true }],
    actaSignedOn: null,
    invoicedOn: null,
    paidOn: null,
  };

  it("follows the payment pipeline", () => {
    expect(hitoStatus({ ...base, paidOn: "2026-10-01" })).toBe("paid");
    expect(hitoStatus({ ...base, invoicedOn: "2026-09-24" })).toBe("invoiced");
    expect(hitoStatus({ ...base, actaSignedOn: "2026-09-24" })).toBe("signed");
    expect(hitoStatus(base)).toBe("ready");
  });

  it("is not ready while a chapter or a check is open", () => {
    expect(hitoStatus({ ...base, checks: [{ done: false }] })).toBe("active");
    expect(hitoStatus({ ...base, readyPct: 60, checks: [] })).toBe("active");
    expect(hitoStatus({ ...base, readyPct: 0, checks: [{ done: false }] })).toBe("pending");
  });

  it("is ready without chapters once its checks are done", () => {
    expect(hitoStatus({ ...base, chapterCount: 0, readyPct: 0 })).toBe("ready");
    expect(hitoStatus({ ...base, chapterCount: 0, readyPct: 0, checks: [{ done: false }] })).toBe("pending");
  });

  it("is pending without chapters or checks until invoiced", () => {
    const empty = { ...base, chapterCount: 0, readyPct: 0, checks: [] };
    expect(hitoStatus(empty)).toBe("pending");
    expect(hitoStatus({ ...empty, invoicedOn: "2026-02-03" })).toBe("invoiced");
  });
});

describe("buildPhases", () => {
  const hito = (code: string, overrides: Partial<Hito> = {}): Hito => ({
    id: `id-${code}`,
    code,
    name: `Hito ${code}`,
    pctBp: 1000,
    amountCents: 0,
    vatCents: 0,
    totalCents: 0,
    scope: "",
    billingMoment: "",
    status: "pending",
    readyPct: 0,
    chapters: [],
    checks: [],
    photoIds: [],
    actaSignedOn: null,
    invoicedOn: null,
    dueOn: null,
    paidOn: null,
    paidAmountCents: null,
    invoiceRequestedAt: null,
    ...overrides,
  });
  const chapter = (code: string, progressPct: number) => ({
    code,
    name: `Cap ${code}`,
    totalCents: 100,
    progressPct,
  });
  const hitos = [
    hito("H0", { paidOn: "2026-02-03" }),
    hito("H1", { paidOn: "2026-04-20" }),
    hito("H2", { chapters: [chapter("01", 100)], readyPct: 100, actaSignedOn: "2026-07-20" }),
    hito("H3", { chapters: [chapter("04", 40)], readyPct: 40, checks: [{ id: "c", label: "Prueba", done: false }] }),
    hito("H4", { chapters: [chapter("05", 0)] }),
  ];
  const photos = new Map([
    ["04", [{ id: "p3", createdAt: 3 }, { id: "p1", createdAt: 1 }]],
    ["05", [{ id: "p2", createdAt: 2 }]],
  ]);

  it("groups the hitos before the first chapter into one pre-construction phase", () => {
    const phases = buildPhases(6, hitos, photos);

    expect(phases.map((p) => [p.key, p.status, p.progressPct])).toEqual([
      ["pre", "done", 100],
      ["H2", "done", 100],
      ["H3", "active", 40],
      ["H4", "pending", 0],
    ]);
    expect(phases[0]).toMatchObject({ name: null, hitoIds: ["id-H0", "id-H1"], finishedOn: "2026-04-20" });
    expect(phases[1]).toMatchObject({ name: "Hito H2", hitoIds: ["id-H2"], finishedOn: "2026-07-20" });
  });

  it("gives each phase its chapters, checks and newest photos", () => {
    const [, , h3] = buildPhases(6, hitos, photos);

    expect(h3).toMatchObject({
      chapters: [chapter("04", 40)],
      checks: [{ id: "c", label: "Prueba", done: false }],
      photoIds: ["p3", "p1"],
      photoCount: 2,
    });
  });

  it("closes a later hito without chapters by its status", () => {
    const withChecks = [...hitos, hito("H9", { checks: [{ id: "d", label: "CFO", done: true }], status: "ready" })];
    expect(buildPhases(6, withChecks, photos).at(-1)).toMatchObject({ key: "H9", status: "done" });
    const open = [...hitos, hito("H9", { checks: [{ id: "d", label: "CFO", done: true }], status: "active" })];
    expect(buildPhases(6, open, photos).at(-1)).toMatchObject({ key: "H9", status: "active" });
  });

  it("keeps pre-construction open until the works start or its hitos are paid", () => {
    const unpaid = [hito("H0"), hito("H1"), ...hitos.slice(2)];
    expect(buildPhases(4, unpaid, photos)[0]).toMatchObject({ status: "active", progressPct: 0 });
    expect(buildPhases(6, unpaid, photos)[0]).toMatchObject({ status: "done", progressPct: 100 });
  });
});
