import {
  DEFAULT_PAYMENT_DAYS,
  DUE_SOON_DAYS,
  PAYMENT_FORECAST_DAYS,
  VAT_RATE_BP,
  defaultVatKind,
  type PurchaseInvoiceAmounts,
  type PurchaseInvoiceKind,
  type PurchaseInvoiceState,
  type PurchaseInvoicing,
  type PurchaseKind,
  type PurchaseProgress,
  type PurchaseTerms,
  type PurchaseVatKind,
} from "./contract";
import { addDays } from "./obra-calc";
import { daysBetween } from "./subcontractor-rules";

// ─── Supplier invoices: arithmetic ───────────────────────────────────────────
// Pure functions behind ./purchase-invoices: an invoice's amounts, how an
// invoice and its credit notes stand once paid, its state, and where a budget
// line stands in purchasing (the four states). Money in cents. No database.
// ─────────────────────────────────────────────────────────────────────────────

/** `cents` × `bp` / 10 000, rounded half away from zero, so a credit note mirrors its invoice. */
export const percentOf = (cents: number, bp: number) => Math.sign(cents) * Math.round((Math.abs(cents) * bp) / 10_000) || 0;

/** An order's invoicing terms: its own, else the defaults. */
export const termsOf = (order: {
  kind: PurchaseKind;
  paymentDays: number | null;
  retentionBp: number;
  vatKind: PurchaseVatKind | null;
}): PurchaseTerms => ({
  paymentDays: order.paymentDays ?? DEFAULT_PAYMENT_DAYS,
  retentionBp: order.retentionBp,
  vatKind: order.vatKind ?? defaultVatKind(order.kind),
});

/** The day an invoice issued on `issuedOn` falls due. */
export const defaultDueOn = (issuedOn: string, paymentDays: number) => addDays(issuedOn, paymentDays);

type AmountInput = Pick<PurchaseInvoiceAmounts, "baseCents" | "vatKind" | "irpfBp" | "retentionBp">;

/** An invoice's amounts from its base and rates: VAT, IRPF and retention on the base. */
export function invoiceAmounts(input: AmountInput): PurchaseInvoiceAmounts {
  const vatCents = percentOf(input.baseCents, VAT_RATE_BP[input.vatKind]);
  const irpfCents = percentOf(input.baseCents, input.irpfBp);
  const retentionCents = percentOf(input.baseCents, input.retentionBp);
  return withTotals({ ...input, vatCents, irpfCents, retentionCents });
}

/** A stored invoice's totals. */
export function withTotals(row: Omit<PurchaseInvoiceAmounts, "totalCents" | "payableCents">): PurchaseInvoiceAmounts {
  const totalCents = row.baseCents + row.vatCents - row.irpfCents;
  return {
    baseCents: row.baseCents,
    vatKind: row.vatKind,
    vatCents: row.vatCents,
    irpfBp: row.irpfBp,
    irpfCents: row.irpfCents,
    retentionBp: row.retentionBp,
    retentionCents: row.retentionCents,
    totalCents,
    payableCents: totalCents - row.retentionCents,
  };
}

/**
 * `total` split in proportion to `weights`, in whole cents that add up
 * exactly (the largest remainders take the cents left over). Weights that add
 * up to nothing split it evenly.
 */
export function splitProportional(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = sum === 0 ? weights.map(() => 1) : weights;
  const shareSum = sum === 0 ? weights.length : sum;
  const abs = Math.abs(total);
  const raw = shares.map((w) => (abs * w) / shareSum);
  const parts = raw.map(Math.floor);
  let left = abs - parts.reduce((a, b) => a + b, 0);
  const byRemainder = raw.map((r, i) => ({ i, rest: r - Math.floor(r) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    parts[i]!++;
    left--;
  }
  const sign = total < 0 ? -1 : 1;
  return parts.map((p) => p * sign || 0);
}

type Settleable = Pick<PurchaseInvoiceAmounts, "baseCents" | "totalCents" | "payableCents" | "retentionCents">;

export type Settlement = ReturnType<typeof settle>;

/**
 * An invoice with its credit notes, once `paidCents` is paid against it:
 * what is still owed by its due date (negative: in our favour), what of the
 * retention is still held, and what may still be paid (the amount due, then
 * the retention once released). `base` gives the same in the base's terms,
 * without VAT, as the obra compares them with the budget's cost.
 */
export function settle(invoice: Settleable, credits: Settleable[], paidCents: number) {
  const all = [invoice, ...credits];
  const sum = (key: keyof Settleable) => all.reduce((total, a) => total + a[key], 0);
  const baseCents = sum("baseCents");
  const totalCents = sum("totalCents");
  const payableCents = sum("payableCents");
  const retentionCents = sum("retentionCents");
  const outstandingCents = payableCents - paidCents;
  const retainedCents = Math.max(0, Math.min(retentionCents, totalCents - paidCents));
  const ratio = totalCents ? baseCents / totalCents : 1;
  const paidBase = Math.round(paidCents * ratio);
  const outstandingBase = Math.round(Math.max(0, outstandingCents) * ratio);
  return {
    totalCents,
    payableCents,
    paidCents,
    outstandingCents,
    retainedCents,
    payableLeftCents: Math.max(0, totalCents - paidCents),
    /** Nothing owed by the due date (the retention may still be held). */
    settled: outstandingCents <= 0,
    base: {
      invoicedCents: baseCents,
      paidCents: paidBase,
      outstandingCents: outstandingBase,
      // What is left of the base, so the four add up.
      retainedCents: retainedCents > 0 ? Math.max(0, baseCents - paidBase - outstandingBase) : 0,
    } satisfies PurchaseInvoicing,
  };
}

/** An invoice's state today, and how many days past due it is while something is owed. */
export function invoiceState(
  invoice: { kind: PurchaseInvoiceKind; dueOn: string | null; paidCents: number; outstandingCents: number },
  today: string,
): { state: PurchaseInvoiceState; overdueDays: number | null } {
  if (invoice.kind === "credit_note") return { state: "credit", overdueDays: null };
  if (invoice.outstandingCents <= 0) return { state: "paid", overdueDays: null };
  if (invoice.dueOn && invoice.dueOn < today) return { state: "overdue", overdueDays: daysBetween(invoice.dueOn, today) };
  return { state: invoice.paidCents > 0 ? "partial" : "pending", overdueDays: null };
}

/** Something is owed on it: pending, part paid or past due. */
export const isOwed = (state: PurchaseInvoiceState) => state === "pending" || state === "partial" || state === "overdue";

/** Owed, not past due, and due within `DUE_SOON_DAYS`. */
export const isDueSoon = (invoice: { state: PurchaseInvoiceState; dueOn: string | null }, today: string) =>
  isOwed(invoice.state) && invoice.state !== "overdue" && invoice.dueOn !== null && invoice.dueOn <= addDays(today, DUE_SOON_DAYS);

/**
 * Where a budget line (or an order's milestone) stands: nothing contracted;
 * contracted, no invoice; invoiced with something still to invoice or pay;
 * paid once it is closed (nothing more to contract), all of it is invoiced
 * and nothing invoiced is owed. The retention doesn't count until released.
 */
export function purchaseProgress(p: {
  contracted: boolean;
  closed: boolean;
  contractedCents: number;
  invoicedCents: number;
  hasInvoices: boolean;
  settled: boolean;
}): PurchaseProgress {
  if (!p.contracted) return "to_contract";
  if (!p.hasInvoices) return "contracted";
  return p.closed && p.invoicedCents >= p.contractedCents && p.settled ? "paid" : "invoiced";
}

/** Invoicing summed up. */
export function addInvoicing(list: PurchaseInvoicing[]): PurchaseInvoicing {
  const total: PurchaseInvoicing = { invoicedCents: 0, paidCents: 0, outstandingCents: 0, retainedCents: 0 };
  for (const i of list) {
    total.invoicedCents += i.invoicedCents;
    total.paidCents += i.paidCents;
    total.outstandingCents += i.outstandingCents;
    total.retainedCents += i.retainedCents;
  }
  return total;
}

/** `invoicing` scaled to a `part` of `whole` (a line's share of an invoice). */
export function shareOf(invoicing: PurchaseInvoicing, part: number, whole: number): PurchaseInvoicing {
  const scale = (cents: number) => (whole ? Math.round((cents * part) / whole) : 0);
  return {
    invoicedCents: part,
    paidCents: scale(invoicing.paidCents),
    outstandingCents: scale(invoicing.outstandingCents),
    retainedCents: scale(invoicing.retainedCents),
  };
}

/**
 * The payments forecast's buckets: past due (`from` null), then 7-day weeks
 * from `today` until `PAYMENT_FORECAST_DAYS` ahead.
 */
export function forecastWeeks(today: string, days = PAYMENT_FORECAST_DAYS) {
  const weeks: { from: string | null; to: string }[] = [{ from: null, to: addDays(today, -1) }];
  for (let start = 0; start <= days; start += 7) {
    weeks.push({ from: addDays(today, start), to: addDays(today, Math.min(start + 6, days)) });
  }
  return weeks;
}
