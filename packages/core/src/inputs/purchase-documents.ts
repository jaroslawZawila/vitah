import { z } from "zod";
import { optionalText, requiredText, uploadedFile } from "./fields";

// The bodies of ../purchase-documents' writes: an order's document and its
// versions. The PDF itself is checked by the service (requirePdf).

const MAX_TITLE = 200;
const MAX_NOTE = 300;

/** A new document of the order: its title, its PDF, why it is there. */
export const orderDocumentSchema = z.object({
  title: requiredText(MAX_TITLE),
  file: uploadedFile,
  note: optionalText(MAX_NOTE),
});

/** A document's next version: its PDF and why it replaces the last. */
export const orderDocumentVersionSchema = z.object({ file: uploadedFile, note: optionalText(MAX_NOTE) });

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** POST /api/v1/purchases/:orderId/documents (multipart), addOrderDocumentAction. */
export type OrderDocumentInput = z.input<typeof orderDocumentSchema>;
/** POST /api/v1/purchases/:orderId/documents/:documentId (multipart), addOrderDocumentVersionAction. */
export type OrderDocumentVersionInput = z.input<typeof orderDocumentVersionSchema>;
