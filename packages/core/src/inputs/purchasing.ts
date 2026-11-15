import { z } from "zod";
import {
  MAX_ORDER_LINES,
  MAX_PAYMENT_DAYS,
  MAX_RETENTION_BP,
  PURCHASE_FLOWS,
  PURCHASE_KINDS,
  PURCHASE_ORDER_GROUPS,
  PURCHASE_VAT_KINDS,
  type PurchaseKind,
  type PurchaseStatus,
} from "../contract";
import {
  basisPoints,
  calendarDate,
  cents,
  id,
  integer,
  oneOf,
  optionalText,
  orNull,
  requiredText,
  workDate,
  type WithIdempotencyKey,
} from "./fields";

// The bodies of ../purchasing's writes (an order: create, edit, status) and
// the order lines ../purchase-requests and ../purchase-amendments take too.
// Fields are in the order the service checked them before; what needs the
// database (the supplier, which contract line, a line given twice) or another
// field (works start before its end) is checked there, after parse.

export const MAX_DESCRIPTION = 500;
export const MAX_NOTES = 2000;
export const MAX_NOTE = 500;

/** A supplier picked from the list (whether it is the tenant's is the service's check): missing, not text or "": `missing_fields`. */
const supplierId = z.string({ error: "missing_fields" }).min(1, { error: "missing_fields" });

/**
 * An order's (a request's, a modificado's) lines: each a budget line by
 * lineage with an amount; `closesLine` (true by default) says nothing more is
 * left to order for it. Which contract line and whether one comes twice are
 * the service's checks.
 */
export const orderLinesSchema = z
  .array(
    z.object(
      {
        lineageId: id,
        closesLine: z.boolean({ error: "invalid_input" }).default(true),
        amountCents: cents(1),
      },
      { error: "invalid_input" },
    ),
    { error: "missing_fields" },
  )
  .min(1, { error: "missing_fields" })
  .max(MAX_ORDER_LINES, { error: "invalid_input" });

/** The lines as parsed, for the service to match with the contract. */
export type OrderLines = z.output<typeof orderLinesSchema>;

/** An order's own fields, as a new order takes them (an edit, each optional). */
const orderFields = {
  description: requiredText(MAX_DESCRIPTION),
  orderedOn: orNull(workDate),
  expectedOn: orNull(calendarDate),
  workStart: orNull(calendarDate),
  workEnd: orNull(calendarDate),
  notes: optionalText(MAX_NOTES),
  // Its invoices' terms: null = the defaults.
  paymentDays: orNull(integer(0, MAX_PAYMENT_DAYS)),
  retentionBp: basisPoints(MAX_RETENTION_BP)
    .nullish()
    .transform((bp) => bp ?? 0),
  vatKind: orNull(oneOf(PURCHASE_VAT_KINDS)),
};

/** Read first: the kind decides the rest of a new order's body. */
export const orderKindSchema = z.object({ kind: oneOf(PURCHASE_KINDS) });

/** A new order with `status`: pending, or placed now (ordered for material, contracted for a subcontract). */
const newOrder = <S extends z.ZodType>(status: S) =>
  z.object({
    subcontractorId: supplierId,
    lines: orderLinesSchema,
    // An approved purchase request's id (null or missing: an order of its own).
    requestId: z.string({ error: "invalid_input" }).min(1, { error: "invalid_input" }).nullish(),
    status,
    ...orderFields,
  });

/** A new order, by its kind. */
export const newOrderSchemas = {
  material: newOrder(oneOf(["pending", PURCHASE_FLOWS.material[1]]).default("pending")),
  subcontract: newOrder(oneOf(["pending", PURCHASE_FLOWS.subcontract[1]]).default("pending")),
} satisfies Record<PurchaseKind, z.ZodType>;

/**
 * An order's changes (`kind` only while pending: the service's check, made
 * once `kind` is read). A null supplier is the order's own, checked again
 * against the kind.
 */
export const orderChangesSchema = z.object({
  kind: oneOf(PURCHASE_KINDS).optional(),
  subcontractorId: supplierId.nullish(),
  description: orderFields.description.optional(),
  orderedOn: orderFields.orderedOn.optional(),
  expectedOn: orderFields.expectedOn.optional(),
  workStart: orderFields.workStart.optional(),
  workEnd: orderFields.workEnd.optional(),
  notes: orderFields.notes.optional(),
  paymentDays: orderFields.paymentDays.optional(),
  retentionBp: orderFields.retentionBp.optional(),
  vatKind: orderFields.vatKind.optional(),
  lines: orderLinesSchema.optional(),
});

const statusChange = <const T extends readonly [string, ...string[]]>(statuses: T) =>
  z.object({
    status: oneOf(statuses),
    // The day it was placed or completed (null or missing: as the service says).
    date: orNull(workDate),
    note: optionalText(MAX_NOTE),
  });

/** A status of the order's kind (read first: the state checks follow), the day, a note. */
export const statusChangeSchemas = {
  material: statusChange([...PURCHASE_FLOWS.material, "cancelled"]),
  subcontract: statusChange([...PURCHASE_FLOWS.subcontract, "cancelled"]),
} satisfies Record<PurchaseKind, z.ZodType>;

/** The tenant's orders list: its filters (all when missing). Paging, search and ids are ../paging's. */
export const purchaseListSchema = z.object({
  group: orNull(oneOf(["all", ...PURCHASE_ORDER_GROUPS])),
  kind: orNull(oneOf(["all", ...PURCHASE_KINDS])),
  from: orNull(calendarDate),
  to: orNull(calendarDate),
  // Never refused: anything but true, "1" or "true" is all of them.
  late: z
    .unknown()
    .optional()
    .transform((late) => late === true || late === "1" || late === "true"),
});

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** The lines of an order (a request's: `closesLine` is ignored; a modificado's: all the order's lines as they will be). */
export type OrderLinesInput = z.input<typeof orderLinesSchema>;
/** POST /api/v1/projects/:id/purchases, createPurchaseAction. */
export type PurchaseOrderInput = WithIdempotencyKey &
  z.input<typeof orderKindSchema> &
  Omit<z.input<typeof newOrderSchemas.material>, "status"> & {
    /** Pending (by default), or the kind's placed status: ordered or contracted. */
    status?: PurchaseStatus;
  };
/** PATCH /api/v1/purchases/:orderId, updatePurchaseAction. */
export type PurchaseOrderChangesInput = z.input<typeof orderChangesSchema>;
/** POST /api/v1/purchases/:orderId/status, setPurchaseStatusAction (a status of the order's kind). */
export type PurchaseStatusInput = Omit<z.input<typeof statusChangeSchemas.material>, "status"> & { status: PurchaseStatus };
