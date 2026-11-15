import { z } from "zod";
import { PURCHASE_KINDS } from "../contract";
import { calendarDate, oneOf, optionalText, orNull, requiredText, type WithIdempotencyKey } from "./fields";
import { MAX_DESCRIPTION, MAX_NOTE, MAX_NOTES, orderLinesSchema } from "./purchasing";

// The bodies of ../purchase-requests' writes. Fields are in the order the
// service checked them before; the supplier (the tenant's, able to take the
// kind) and the lines (the contract's, once each) are checked there, after parse.

/** A suggested supplier, or none (missing, null or ""); not text: `missing_fields`. */
const suggestedSupplier = orNull(z.string({ error: "missing_fields" }));

/** A new request: what to buy, on which lines (an estimate each; `closesLine` is checked, then ignored). */
export const newRequestSchema = z.object({
  kind: oneOf(PURCHASE_KINDS),
  subcontractorId: suggestedSupplier,
  lines: orderLinesSchema,
  description: requiredText(MAX_DESCRIPTION),
  neededBy: orNull(calendarDate),
  notes: optionalText(MAX_NOTES),
});

/** A pending request's changes: any of a new one's fields (null clears the supplier, the day, the notes). */
export const requestChangesSchema = z.object({
  kind: newRequestSchema.shape.kind.optional(),
  description: newRequestSchema.shape.description.optional(),
  neededBy: newRequestSchema.shape.neededBy.optional(),
  notes: newRequestSchema.shape.notes.optional(),
  lines: orderLinesSchema.optional(),
  subcontractorId: suggestedSupplier.optional(),
});

/** An admin's decision; the note is required to reject (the service's check). */
export const requestDecisionSchema = z.object({
  decision: oneOf(["approve", "reject"]),
  note: optionalText(MAX_NOTE),
});

/** Withdrawing a request: why, optionally. */
export const requestCancelSchema = z.object({ note: optionalText(MAX_NOTE) });

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** POST /api/v1/projects/:id/purchases/requests, createRequestAction. */
export type PurchaseRequestInput = WithIdempotencyKey & z.input<typeof newRequestSchema>;
/** PATCH /api/v1/purchases/requests/:requestId, updateRequestAction. */
export type PurchaseRequestChangesInput = z.input<typeof requestChangesSchema>;
/** POST /api/v1/purchases/requests/:requestId/decision, decideRequestAction. */
export type PurchaseRequestDecisionInput = z.input<typeof requestDecisionSchema>;
/** POST /api/v1/purchases/requests/:requestId/cancel, cancelRequestAction. */
export type PurchaseRequestCancelInput = z.input<typeof requestCancelSchema>;
