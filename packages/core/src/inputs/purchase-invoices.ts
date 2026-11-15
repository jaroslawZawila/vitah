import { z } from "zod";
import {
  MAX_IRPF_BP,
  MAX_MILESTONES,
  MAX_RETENTION_BP,
  PURCHASE_INVOICE_GROUPS,
  PURCHASE_INVOICE_KINDS,
  PURCHASE_PAYMENT_METHODS,
  PURCHASE_VAT_KINDS,
  type PurchaseInvoiceKind,
} from "../contract";
import { MAX_AMOUNT_CENTS } from "../money";
import {
  basisPoints,
  calendarDate,
  cents,
  id,
  oneOf,
  optionalText,
  orNull,
  refused,
  requiredText,
  uploadedFile,
  workDate,
  type WithIdempotencyKey,
} from "./fields";
import { MAX_NOTES } from "./purchasing";

// The bodies of ../purchase-invoices' writes (supplier invoices, credit notes,
// payments, an order's payment schedule). Fields are in the order the service
// checked them before; what needs the order or the invoice (its lines, its
// schedule, what is left to pay) is checked there, after parse.

const MAX_NUMBER = 60;
const MAX_CONCEPT = 200;
const MAX_REFERENCE = 120;
const MAX_FILE_NOTE = 300;

/** An invoice's base is positive; a credit note's, negative. */
const baseCents = { invoice: cents(1), credit_note: cents(-MAX_AMOUNT_CENTS, -1) } satisfies Record<PurchaseInvoiceKind, z.ZodType>;

/** A split across the order's lines, as given; which lines, their sign and their sum are the service's checks. */
const invoiceLines = z
  .array(z.object({ lineageId: id, amountCents: cents(-MAX_AMOUNT_CENTS) }, { error: "invalid_input" }), { error: "invalid_input" })
  .min(1, { error: "invalid_input" });

/** Read first: the kind decides the rest of a new invoice's body. */
export const invoiceKindSchema = z.object({ kind: oneOf(PURCHASE_INVOICE_KINDS).default("invoice") });

/** The rates: the order's (or the rectified invoice's) when missing. */
const rateFields = {
  vatKind: oneOf(PURCHASE_VAT_KINDS).optional(),
  irpfBp: basisPoints(MAX_IRPF_BP).optional(),
  retentionBp: basisPoints(MAX_RETENTION_BP).optional(),
};

/** The split: in proportion to the order's lines (or the rectified invoice's) when missing or null. */
const lines = invoiceLines.nullish();

const describedFields = {
  number: requiredText(MAX_NUMBER),
  notes: optionalText(MAX_NOTES),
  file: uploadedFile,
};

/**
 * A new invoice: milestoneId (required by the service when the order has a
 * schedule), dueOn (else the order's days to pay); a credit note: the invoice
 * it rectifies, no due date nor milestone of its own (ignored if sent).
 */
export const newInvoiceSchemas = {
  invoice: z.object({
    milestoneId: id.nullish(),
    issuedOn: workDate,
    dueOn: orNull(calendarDate),
    baseCents: baseCents.invoice,
    ...rateFields,
    lines,
    ...describedFields,
  }),
  credit_note: z.object({
    rectifiesId: z.string({ error: "missing_fields" }),
    issuedOn: workDate,
    baseCents: baseCents.credit_note,
    ...rateFields,
    lines,
    ...describedFields,
  }),
} satisfies Record<PurchaseInvoiceKind, z.ZodType>;

/** An invoice's changes, by the stored invoice's kind: a credit note has no due date nor milestone. */
export const invoiceChangesSchemas = {
  invoice: z.object({
    number: requiredText(MAX_NUMBER).optional(),
    issuedOn: workDate.optional(),
    dueOn: calendarDate.optional(),
    notes: optionalText(MAX_NOTES).optional(),
    baseCents: baseCents.invoice.optional(),
    ...rateFields,
    milestoneId: id.optional(),
    lines,
  }),
  credit_note: z.object({
    number: requiredText(MAX_NUMBER).optional(),
    issuedOn: workDate.optional(),
    dueOn: refused,
    notes: optionalText(MAX_NOTES).optional(),
    baseCents: baseCents.credit_note.optional(),
    ...rateFields,
    milestoneId: refused,
    lines,
  }),
} satisfies Record<PurchaseInvoiceKind, z.ZodType>;

/** A new version of an invoice's PDF (the file checked by the service). */
export const invoiceFileSchema = z.object({ file: uploadedFile, note: optionalText(MAX_FILE_NOTE) });

/** A payment: today when no day is given, by transfer when no method is. */
export const paymentSchema = z.object({
  paidOn: workDate.optional(),
  amountCents: cents(1),
  method: oneOf(PURCHASE_PAYMENT_METHODS).optional(),
  reference: optionalText(MAX_REFERENCE),
  file: uploadedFile,
});

/** An order's payment schedule, in turn; ids keep existing milestones (unique: the service's check). */
export const milestonesSchema = z.object({
  milestones: z
    .array(
      z.object({ id: id.optional(), concept: requiredText(MAX_CONCEPT), amountCents: cents(1) }, { error: "invalid_input" }),
      { error: "missing_fields" },
    )
    .max(MAX_MILESTONES, { error: "invalid_input" }),
});

/** Administration's invoice list: the group shown (all when missing). Paging and search are ../paging's. */
export const invoiceListSchema = z.object({ group: orNull(oneOf(["all", ...PURCHASE_INVOICE_GROUPS] as const)) });

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** POST /api/v1/purchases/:orderId/invoices, createInvoiceAction. */
export type PurchaseInvoiceInput = WithIdempotencyKey &
  (
    | ({ kind?: "invoice" } & z.input<typeof newInvoiceSchemas.invoice>)
    | ({ kind: "credit_note" } & z.input<typeof newInvoiceSchemas.credit_note>)
  );
/** PATCH /api/v1/purchases/invoices/:invoiceId, updateInvoiceAction (a credit note takes neither dueOn nor milestoneId). */
export type PurchaseInvoiceChangesInput = z.input<typeof invoiceChangesSchemas.invoice>;
/** POST /api/v1/purchases/invoices/:invoiceId/payments, createPaymentAction. */
export type PurchasePaymentInput = WithIdempotencyKey & z.input<typeof paymentSchema>;
/** PUT /api/v1/purchases/:orderId/milestones, setOrderMilestonesAction. */
export type OrderMilestonesInput = z.input<typeof milestonesSchema>;
/** POST /api/v1/purchases/invoices/:invoiceId/file, addInvoiceFileAction. */
export type InvoiceFileInput = z.input<typeof invoiceFileSchema>;
