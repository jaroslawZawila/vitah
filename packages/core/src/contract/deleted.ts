// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

// ─── Deleted records (Elementos eliminados) ──────────────────────────────────
// What a user deletes keeps its row (`deleted_at`, `deleted_by_id`) and its
// files; an admin sees those records here and brings one back (./deleted).

export const DELETED_KINDS = [
  "project",
  "document",
  "photo",
  "issue_file",
  "assignment",
  "order_document",
  "invoice",
  "payment",
] as const;
export type DeletedKind = (typeof DELETED_KINDS)[number];
export const isDeletedKind = (value: unknown): value is DeletedKind => DELETED_KINDS.includes(value as DeletedKind);

/** Why a deleted record can't come back as things stand (known before trying). */
export type DeletedBlock = "parent_deleted" | "ref_taken" | "duplicate_number";

/**
 * A deleted record, as a person recognises it. `label` and `detail` by kind:
 * a project's ref and address; a document's title and file name; a photo's
 * caption (else its day); an incident file's name and its incident (INC-003);
 * a company's name (the obra is `projectRef`); an order document's title and
 * its order (PED-001 · description); an invoice's number and supplier; a
 * payment's invoice number and supplier. `day` is a photo's day, an invoice's
 * date or a payment's; `amountCents` an invoice's total or a payment's amount.
 */
export type DeletedItem = {
  kind: DeletedKind;
  id: string;
  label: string;
  detail: string | null;
  day: string | null;
  amountCents: number | null;
  projectId: string;
  projectRef: string;
  deletedAt: string;
  deletedBy: { id: string; name: string } | null;
  /** True, or why not: the parent that is itself deleted is in `parent`. */
  restorable: true | DeletedBlock;
  parent: { kind: "project" | "invoice"; label: string } | null;
};

/** An obra with deleted records (itself deleted, maybe), to filter by. */
export type DeletedProjectOption = { id: string; ref: string; deleted: boolean };

/** A page of deleted records, newest deletion first. `projects` comes with the first page only. */
export type DeletedList = {
  items: DeletedItem[];
  /** For the next page; null on the last one. */
  nextCursor: string | null;
  projects?: DeletedProjectOption[];
};

export type DeletedFilters = { kind?: DeletedKind; projectId?: string; limit?: number; cursor?: string };

/** What restoring answers: its own refusals, and those of the record's module (an invoice's, a payment's, an assignment's). */
export type DeletedError =
  | DeletedBlock
  | "invalid_input"
  | "invalid_state"
  | "invalid_date"
  | "unknown_line"
  | "missing_fields"
  | "exceeds_amount"
  | "supplies_only"
  | "not_found"
  | "forbidden";
