// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

// ─── The AI's review of purchase documents ───────────────────────────────────
// Each PDF of Compras (an order document's version, an invoice's PDF, a
// payment's proof) is read against what its record says. Warnings only: it
// never blocks, moves, deletes or changes a file or a record.

export const DOCUMENT_FINDINGS = [
  "wrong_document",
  "other_project",
  "supplier_mismatch",
  "amount_mismatch",
  "date_mismatch",
  "number_mismatch",
  "duplicate",
  "unreadable",
  "inconsistency",
] as const;
export type DocumentFindingKind = (typeof DOCUMENT_FINDINGS)[number];

export type DocumentFinding = {
  kind: DocumentFindingKind;
  /** What the AI saw, in both languages; none for a duplicate (`duplicate` says of what). */
  detail: { es: string; en: string } | null;
  /** The same file, already uploaded. */
  duplicate?: { label: string; orderId: string; projectId: string; invoiceId: string | null };
};

export type PurchaseDocumentCheck = {
  id: string;
  subject: "order_document" | "invoice_file" | "payment_proof";
  /** The file reviewed, as its record names it. */
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  findings: DocumentFinding[];
  /** Why it wasn't reviewed: the tenant's monthly AI limit. */
  reason: "ai_limit" | null;
  checkedAt: string | null;
  dismissedAt: string | null;
  dismissedBy: string | null;
};
