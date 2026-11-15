import { z } from "zod";
import { optionalText, orNull, requiredText, uploadedFile, workDate, type WithIdempotencyKey } from "./fields";
import { MAX_DESCRIPTION, orderLinesSchema } from "./purchasing";

// The body of ../purchase-amendments' modificado. Fields are in the order the
// service checked them before; the day against the order's, the PDF and the
// lines against the contract are checked there, after parse.

export const MAX_TITLE = 200;

/**
 * A modificado: why, the day it was signed (today when missing, null or ""),
 * its signed PDF's name ("{n}" its number) and file, and all the order's
 * lines as they will be.
 */
export const amendmentSchema = z.object({
  concept: requiredText(MAX_DESCRIPTION),
  signedOn: orNull(workDate),
  documentTitle: optionalText(MAX_TITLE),
  file: uploadedFile,
  lines: orderLinesSchema,
});

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** POST /api/v1/purchases/:orderId/amendments (JSON, or multipart with these as JSON in `data` and the PDF in `file`), amendPurchaseAction. */
export type PurchaseAmendmentInput = WithIdempotencyKey & z.input<typeof amendmentSchema>;
