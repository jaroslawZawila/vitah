import type {
  PurchaseInvoiceDetail,
  PurchaseInvoiceForm,
  PurchaseInvoiceKind,
  PurchaseVatKind,
} from "@repo/core/contract";
import { defaultDueOn, invoiceAmounts, splitProportional } from "@repo/core/purchase-calc";

// What the invoice form holds (amounts and % as typed) and how it turns into
// the body of createInvoiceAction / updateInvoiceAction. The arithmetic is
// core's own (purchase-calc), so the summary shows what will be stored.

export type InvoiceDraft = {
  kind: PurchaseInvoiceKind;
  number: string;
  issuedOn: string;
  /** "" = the order's days to pay from the invoice's date. */
  dueOn: string;
  /** A credit note's invoice. */
  rectifiesId: string;
  milestoneId: string;
  /** Euros as typed, always positive (a credit note's is taken off). */
  base: string;
  vatKind: PurchaseVatKind;
  /** % as typed. */
  retention: string;
  irpf: string;
  /** Each order line's share as typed; null = in proportion to the order. */
  lines: Record<string, string> | null;
  notes: string;
  /** A new invoice's PDF. */
  file: File | null;
};

/** A form for an action taking a file: its fields as JSON in `data`, and the file in `file`. */
export function formWithFile(data: Record<string, unknown>, file: File | null) {
  const form = new FormData();
  form.set("data", JSON.stringify(data));
  if (file) form.set("file", file);
  return form;
}

/** Writes cents as euros and basis points as a % to type over. */
export type Writers = { decimal: (value: number) => string; pctInput: (bp: number) => string };

/** Reads typed euros (or a %) into hundredths; NaN when it isn't a number. */
export type Parse = (text: string) => number;
type Order = NonNullable<PurchaseInvoiceForm["order"]>;

/** The first milestone with something left to invoice, else none. */
const nextMilestone = (order: Order) => order.milestones.find((m) => m.invoicedCents < m.amountCents) ?? null;

/** A % field's text: empty for none. */
const pctText = (bp: number, w: Writers) => (bp ? w.pctInput(bp) : "");

export function newInvoiceDraft(form: PurchaseInvoiceForm, w: Writers, rectifiesId?: string): InvoiceDraft {
  const order = form.order;
  const rectified = order?.invoices.find((i) => i.id === rectifiesId && i.kind === "invoice");
  const milestone = order && !rectified ? nextMilestone(order) : null;
  const left = milestone ? milestone.amountCents - milestone.invoicedCents : (order?.invoicing.toInvoiceCents ?? 0);
  return {
    kind: rectified ? "credit_note" : "invoice",
    number: "",
    issuedOn: form.today,
    dueOn: "",
    rectifiesId: rectified?.id ?? "",
    milestoneId: milestone?.id ?? "",
    base: !rectified && left > 0 ? w.decimal(left / 100) : "",
    vatKind: rectified?.vatKind ?? order?.terms.vatKind ?? "vat21",
    retention: pctText(rectified ? rectified.retentionBp : (order?.terms.retentionBp ?? 0), w),
    irpf: pctText(rectified?.irpfBp ?? 0, w),
    lines: null,
    notes: "",
    file: null,
  };
}

/**
 * The invoice being edited as form values; its split as stored when it
 * isn't the order's proportions (so editing doesn't redo it).
 */
export function invoiceDraftFrom(invoice: PurchaseInvoiceDetail, order: Order | null, w: Writers): InvoiceDraft {
  const stored = new Map(invoice.lines.map((l) => [l.lineageId, l.amountCents]));
  const proportional = order ? splitProportional(invoice.baseCents, order.lines.map((l) => l.amountCents)) : [];
  const custom = !!order && order.lines.some((line, i) => (stored.get(line.lineageId) ?? 0) !== (proportional[i] ?? 0));
  return {
    kind: invoice.kind,
    number: invoice.number,
    issuedOn: invoice.issuedOn,
    dueOn: invoice.dueOn ?? "",
    rectifiesId: invoice.rectifiesId ?? "",
    milestoneId: invoice.milestoneId ?? "",
    base: w.decimal(Math.abs(invoice.baseCents) / 100),
    vatKind: invoice.vatKind,
    retention: pctText(invoice.retentionBp, w),
    irpf: pctText(invoice.irpfBp, w),
    lines: custom ? Object.fromEntries(order.lines.map((l) => [l.lineageId, w.decimal((stored.get(l.lineageId) ?? 0) / 100)])) : null,
    notes: invoice.notes ?? "",
    file: null,
  };
}

const bp = (text: string, parse: Parse) => (text.trim() === "" ? 0 : parse(text));

/** The draft's base in cents, signed (negative for a credit note); NaN when it isn't an amount. */
export const draftBase = (draft: InvoiceDraft, parse: Parse) => parse(draft.base) * (draft.kind === "credit_note" ? -1 : 1);

/** What will be stored: VAT, IRPF, retention, total and what is due, as core computes them. */
export function draftAmounts(draft: InvoiceDraft, parse: Parse) {
  const baseCents = draftBase(draft, parse);
  const irpfBp = bp(draft.irpf, parse);
  const retentionBp = bp(draft.retention, parse);
  if (![baseCents, irpfBp, retentionBp].every(Number.isFinite)) return null;
  return invoiceAmounts({ baseCents, vatKind: draft.vatKind, irpfBp, retentionBp });
}

/** The day it falls due: as typed, else the order's days to pay from its date. */
export const draftDueOn = (draft: InvoiceDraft, paymentDays: number) =>
  draft.dueOn || (draft.issuedOn ? defaultDueOn(draft.issuedOn, paymentDays) : "");

/** Each order line's share: as typed, else in proportion to what the order contracts of each. */
export function draftSplit(draft: InvoiceDraft, order: Order, parse: Parse) {
  const base = draftBase(draft, parse);
  if (draft.lines) {
    // A line left blank takes nothing.
    return order.lines.map((line) => {
      const typed = (draft.lines![line.lineageId] ?? "").trim();
      return { lineageId: line.lineageId, cents: typed === "" ? 0 : parse(typed) };
    });
  }
  const parts = splitProportional(Number.isFinite(base) ? base : 0, order.lines.map((l) => l.amountCents));
  return order.lines.map((line, i) => ({ lineageId: line.lineageId, cents: parts[i] ?? 0 }));
}

/** Whether a typed split adds up to the base (always, in proportion). */
export function splitMatches(draft: InvoiceDraft, order: Order, parse: Parse) {
  if (!draft.lines) return true;
  const sum = draftSplit(draft, order, parse).reduce((total, l) => total + (Number.isFinite(l.cents) ? l.cents : NaN), 0);
  return sum === draftBase(draft, parse);
}

/** Whether core has what it needs: a number, a date, an amount, the milestone or invoice it goes to. */
export function invoiceComplete(draft: InvoiceDraft, order: Order, parse: Parse) {
  const amounts = draftAmounts(draft, parse);
  return (
    draft.number.trim() !== "" &&
    draft.issuedOn !== "" &&
    amounts !== null &&
    amounts.baseCents !== 0 &&
    (draft.kind === "credit_note" ? draft.rectifiesId !== "" : order.milestones.length === 0 || draft.milestoneId !== "") &&
    splitMatches(draft, order, parse)
  );
}

/** The body for createInvoiceAction (without its file) or, with `locked`, the fields updateInvoiceAction may still change. */
export function invoiceInput(draft: InvoiceDraft, order: Order, parse: Parse, { locked = false } = {}): Record<string, unknown> {
  const credit = draft.kind === "credit_note";
  const always = {
    number: draft.number.trim(),
    issuedOn: draft.issuedOn,
    ...(credit ? {} : { dueOn: draftDueOn(draft, order.terms.paymentDays) }),
    notes: draft.notes.trim() || null,
  };
  if (locked) return always;
  const lines = draft.lines && !credit
    ? draftSplit(draft, order, parse)
        .filter((l) => l.cents !== 0)
        .map((l) => ({ lineageId: l.lineageId, amountCents: l.cents }))
    : undefined;
  return {
    ...always,
    kind: draft.kind,
    ...(credit ? { rectifiesId: draft.rectifiesId } : {}),
    ...(!credit && order.milestones.length > 0 ? { milestoneId: draft.milestoneId } : {}),
    baseCents: draftBase(draft, parse),
    vatKind: draft.vatKind,
    irpfBp: bp(draft.irpf, parse),
    retentionBp: bp(draft.retention, parse),
    ...(lines ? { lines } : {}),
  };
}
