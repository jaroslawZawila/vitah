// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { type AnyPgColumn, check } from "drizzle-orm/pg-core";

/**
 * The words each text status/kind column may hold. A column's TypeScript type
 * and its CHECK constraint (`oneOf`) both come from its list here, and core's
 * contract constants are tested against them (packages/core/test/schema-values.test.ts).
 * Adding a value: here, in core's constant, and a production SQL file that
 * replaces the constraint.
 */
export const COLUMN_VALUES = {
  language: ["es", "en"],
  budgetInput: ["plans", "basic", "execution", "measurements"],
  budgetPdf: ["general", "detailed"],
  budgetModel: ["framer20"],
  budgetQuality: ["framer", "project"],
  budgetChapterKind: ["chapter", "option"],
  budgetOptionKind: ["extra", "alternative", "deduction"],
  budgetLineSource: ["base", "estimated", "manual", "computed"],
  progressEventKind: ["start", "finish", "correct_start", "correct_finish"],
  hitoEventAction: [
    "acta_uploaded",
    "acta_removed",
    "invoice_uploaded",
    "invoice_removed",
    "payment_registered",
    "payment_cancelled",
  ],
  issueKind: ["issue", "change"],
  issueParty: ["client", "subcontractor", "own", "other"],
  issueStatus: ["pending", "review", "resolved"],
  budgetGenerationStatus: ["queued", "running", "succeeded", "failed", "cancelled"],
  purchaseKind: ["material", "subcontract"],
  // Each kind's flow (either may also be cancelled): an order only ever holds its own kind's.
  purchaseMaterialStatus: ["pending", "ordered", "confirmed", "in_transit", "delivered", "cancelled"],
  purchaseSubcontractStatus: ["pending", "contracted", "finished", "cancelled"],
  purchaseVatKind: ["vat21", "vat10", "reverse_charge", "exempt"],
  purchaseInvoiceKind: ["invoice", "credit_note"],
  purchaseRequestStatus: ["pending", "approved", "rejected", "ordered", "cancelled"],
  purchasePaymentMethod: ["transfer", "confirming", "promissory_note", "direct_debit"],
  purchaseCheckStatus: ["pending", "running", "done", "failed", "skipped"],
  planningStatus: ["draft", "approved", "superseded"],
  planningRegion: ["as", "cb", "cl", "ga", "md"],
  caeStatus: ["apta", "pendiente", "bloqueada"],
  budgetApprovalStatus: ["pending", "approved", "rejected", "withdrawn", "lapsed"],
  warrantyKind: ["finishes", "plumbing", "electrical", "carpentry", "damp", "other"],
  warrantyRoom: ["bathroom", "kitchen", "living_room", "bedroom", "hall", "exterior", "other"],
  warrantyStatus: ["received", "in_review", "scheduled", "resolved", "rejected", "cancelled"],
  warrantyEventAction: ["created", "photo_added", "updated", "cancelled"],
} as const satisfies Record<string, readonly string[]>;

/** `values` as an SQL list of literals; they are plain words, never input. */
export function sqlList(values: readonly string[]) {
  for (const value of values) {
    if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`Not a plain word: ${value}`);
  }
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

/**
 * The ranges three CHECK constraints repeat from core's constants (the obra's
 * stages, the AI run's steps, the levels of subcontracting):
 * packages/core/test/schema-values.test.ts compares them, so raising one in
 * core without a prod SQL file fails there, not in production.
 */
export const COLUMN_RANGES = {
  obraStage: [1, 8],
  generationStep: [0, 5],
  chainLevel: [1, 3],
} as const satisfies Record<string, readonly [number, number]>;

/** CHECK: the column is within `range`, both ends included. */
export const within = (name: string, column: AnyPgColumn, [min, max]: readonly [number, number]) =>
  check(name, sql`${column} between ${sql.raw(String(min))} and ${sql.raw(String(max))}`);

/** CHECK: the column holds one of `values` (or null, when it is nullable). */
export const oneOf = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(name, sql`${column} in (${sqlList(values)})`);

/**
 * CHECK on a soft-deleted table: who deleted it only with when. Not "both or
 * neither": `deleted_by_id` is set null when that user is deleted, while the
 * row stays deleted.
 */
export const deletedTogether = (name: string, table: { deletedAt: AnyPgColumn; deletedById: AnyPgColumn }) =>
  check(name, sql`${table.deletedById} is null or ${table.deletedAt} is not null`);

/** CHECK: a basis-point share, 0–100 %. */
export const basisPoints = (name: string, column: AnyPgColumn) => check(name, sql`${column} between 0 and 10000`);

/** CHECK: a count, size or amount that is never negative (or null). */
export const notNegative = (name: string, column: AnyPgColumn) => check(name, sql`${column} >= 0`);

/** CHECK: an end that is never before its start (either may be null). */
export const inOrder = (name: string, start: AnyPgColumn, end: AnyPgColumn) => check(name, sql`${end} >= ${start}`);
