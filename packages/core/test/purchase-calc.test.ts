import { describe, expect, it } from "vitest";
import {
  defaultDueOn,
  forecastWeeks,
  invoiceAmounts,
  invoiceState,
  isDueSoon,
  percentOf,
  purchaseProgress,
  settle,
  shareOf,
  splitProportional,
  termsOf,
} from "../src/purchase-calc";

describe("invoiceAmounts", () => {
  it("adds VAT, withholds IRPF and holds the retention back from what is due", () => {
    expect(invoiceAmounts({ baseCents: 100_000, vatKind: "vat21", irpfBp: 1500, retentionBp: 500 })).toEqual({
      baseCents: 100_000,
      vatKind: "vat21",
      vatCents: 21_000,
      irpfBp: 1500,
      irpfCents: 15_000,
      retentionBp: 500,
      retentionCents: 5_000,
      totalCents: 106_000,
      payableCents: 101_000,
    });
  });

  it("charges no VAT on a reverse-charged subcontract", () => {
    expect(invoiceAmounts({ baseCents: 3_000_000, vatKind: "reverse_charge", irpfBp: 0, retentionBp: 500 })).toMatchObject({
      vatCents: 0,
      totalCents: 3_000_000,
      retentionCents: 150_000,
      payableCents: 2_850_000,
    });
  });

  it("mirrors an invoice in its credit note, rounding the same way", () => {
    const invoice = invoiceAmounts({ baseCents: 333, vatKind: "vat21", irpfBp: 0, retentionBp: 500 });
    const credit = invoiceAmounts({ baseCents: -333, vatKind: "vat21", irpfBp: 0, retentionBp: 500 });
    expect(credit.vatCents).toBe(-invoice.vatCents);
    expect(credit.retentionCents).toBe(-invoice.retentionCents);
    expect(percentOf(0, 2100)).toBe(0);
    expect(Object.is(percentOf(-1, 100), -0)).toBe(false);
  });
});

describe("splitProportional", () => {
  it("splits to the cent, the largest remainders taking what is left", () => {
    expect(splitProportional(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitProportional(2_700_000, [8_000_000])).toEqual([2_700_000]);
    expect(splitProportional(1000, [300, 700])).toEqual([300, 700]);
  });

  it("keeps a negative total's sign and splits nothing-weights evenly", () => {
    expect(splitProportional(-100, [1, 2])).toEqual([-33, -67]);
    expect(splitProportional(10, [0, 0])).toEqual([5, 5]);
    expect(splitProportional(10, [])).toEqual([]);
  });
});

describe("settle", () => {
  const invoice = invoiceAmounts({ baseCents: 3_000_000, vatKind: "reverse_charge", irpfBp: 0, retentionBp: 500 });

  it("owes what is due less what was paid, holding the retention", () => {
    const s = settle(invoice, [], 1_500_000);
    expect(s).toMatchObject({ outstandingCents: 1_350_000, retainedCents: 150_000, payableLeftCents: 1_500_000, settled: false });
    expect(s.base).toEqual({ invoicedCents: 3_000_000, paidCents: 1_500_000, outstandingCents: 1_350_000, retainedCents: 150_000 });
  });

  it("is settled once what is due is paid, then releases the retention", () => {
    expect(settle(invoice, [], 2_850_000)).toMatchObject({ settled: true, outstandingCents: 0, retainedCents: 150_000, payableLeftCents: 150_000 });
    expect(settle(invoice, [], 3_000_000)).toMatchObject({ settled: true, retainedCents: 0, payableLeftCents: 0 });
  });

  it("takes a credit note off what is owed, and leaves a balance in our favour once paid", () => {
    const credit = invoiceAmounts({ baseCents: -120_000, vatKind: "reverse_charge", irpfBp: 0, retentionBp: 0 });
    expect(settle(invoice, [credit], 1_500_000)).toMatchObject({ outstandingCents: 1_230_000, settled: false });
    expect(settle(invoice, [credit], 2_850_000)).toMatchObject({ outstandingCents: -120_000, settled: true });
  });

  it("gives the base's share of what is paid and owed when VAT is charged", () => {
    const vat = invoiceAmounts({ baseCents: 100_000, vatKind: "vat21", irpfBp: 0, retentionBp: 500 });
    const { base } = settle(vat, [], 58_000);
    expect(base.paidCents).toBe(Math.round((58_000 * 100_000) / 121_000));
    expect(base.paidCents + base.outstandingCents + base.retainedCents).toBe(100_000);
  });
});

describe("invoiceState", () => {
  const today = "2026-10-19";
  const state = (dueOn: string | null, paidCents: number, outstandingCents: number, kind: "invoice" | "credit_note" = "invoice") =>
    invoiceState({ kind, dueOn, paidCents, outstandingCents }, today);

  it("tells pending, part paid, past due and paid apart", () => {
    expect(state("2026-10-22", 0, 100)).toEqual({ state: "pending", overdueDays: null });
    expect(state("2026-10-22", 50, 50)).toEqual({ state: "partial", overdueDays: null });
    expect(state("2026-10-15", 50, 50)).toEqual({ state: "overdue", overdueDays: 4 });
    expect(state("2026-10-15", 100, 0)).toEqual({ state: "paid", overdueDays: null });
    expect(state(null, 0, 0, "credit_note")).toEqual({ state: "credit", overdueDays: null });
  });

  it("is due soon within a week, not after and not once paid", () => {
    expect(isDueSoon({ state: "pending", dueOn: "2026-10-26" }, today)).toBe(true);
    expect(isDueSoon({ state: "partial", dueOn: "2026-10-19" }, today)).toBe(true);
    expect(isDueSoon({ state: "pending", dueOn: "2026-10-27" }, today)).toBe(false);
    expect(isDueSoon({ state: "paid", dueOn: "2026-10-20" }, today)).toBe(false);
    expect(isDueSoon({ state: "overdue", dueOn: "2026-10-18" }, today)).toBe(false);
  });
});

describe("purchaseProgress", () => {
  const p = (overrides: Partial<Parameters<typeof purchaseProgress>[0]> = {}) =>
    purchaseProgress({
      contracted: true,
      closed: true,
      contractedCents: 8_700_000,
      invoicedCents: 8_700_000,
      hasInvoices: true,
      settled: true,
      ...overrides,
    });

  it("follows the four states", () => {
    expect(p({ contracted: false, hasInvoices: false, invoicedCents: 0 })).toBe("to_contract");
    expect(p({ hasInvoices: false, invoicedCents: 0 })).toBe("contracted");
    expect(p({ settled: false })).toBe("invoiced");
    expect(p()).toBe("paid");
  });

  it("isn't paid while a milestone is still to invoice or the line still open", () => {
    expect(p({ invoicedCents: 6_000_000 })).toBe("invoiced");
    expect(p({ closed: false })).toBe("invoiced");
  });
});

describe("terms and dates", () => {
  it("defaults an order's terms by its kind", () => {
    expect(termsOf({ kind: "subcontract", paymentDays: null, retentionBp: 500, vatKind: null })).toEqual({
      paymentDays: 30,
      retentionBp: 500,
      vatKind: "reverse_charge",
    });
    expect(termsOf({ kind: "material", paymentDays: 60, retentionBp: 0, vatKind: "vat10" })).toEqual({
      paymentDays: 60,
      retentionBp: 0,
      vatKind: "vat10",
    });
    expect(defaultDueOn("2026-09-22", 30)).toBe("2026-10-22");
  });

  it("shares a group's money out to a line", () => {
    expect(shareOf({ invoicedCents: 1000, paidCents: 500, outstandingCents: 400, retainedCents: 100 }, 250, 1000)).toEqual({
      invoicedCents: 250,
      paidCents: 125,
      outstandingCents: 100,
      retainedCents: 25,
    });
  });

  it("buckets the forecast: past due, then weeks from today", () => {
    const weeks = forecastWeeks("2026-10-19");
    expect(weeks[0]).toEqual({ from: null, to: "2026-10-18" });
    expect(weeks[1]).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(weeks.at(-1)).toEqual({ from: "2026-11-16", to: "2026-11-18" });
  });
});
