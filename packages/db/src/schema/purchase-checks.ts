// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { COLUMN_VALUES, oneOf } from "./checks";
import { purchaseInvoiceFiles, purchasePayments } from "./purchase-invoices";
import { purchaseOrderDocumentVersions, purchaseOrders } from "./purchasing";
import { tenants } from "./tenants";
import { users } from "./users";

export type PurchaseCheckStatus = (typeof COLUMN_VALUES.purchaseCheckStatus)[number];

// The AI's review of one purchase PDF (an order document's version, an
// invoice's PDF or a payment's proof): warnings only, it never changes a
// record or a file. Exactly one subject is set; a check goes with its
// subject. `sha256` finds the same file uploaded twice.
export const purchaseDocumentChecks = pgTable(
  "purchase_document_checks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    documentVersionId: text("document_version_id"),
    invoiceFileId: text("invoice_file_id"),
    paymentId: text("payment_id"),
    // The file reviewed (a payment's proof may be replaced: a new one is reviewed again).
    pathname: text("pathname").notNull(),
    label: text("label").notNull(),
    sha256: text("sha256"),
    status: text("status").$type<PurchaseCheckStatus>().default("pending").notNull(),
    // [{ kind, detail: { es, en } | null, duplicate?: { label, orderId, invoiceId } }]
    findings: jsonb("findings").$type<Record<string, unknown>[]>().default([]).notNull(),
    // Why it wasn't reviewed (`ai_limit`) or what failed.
    reason: text("reason"),
    // When a run took it (one left running past 15 minutes is taken again), and when it ended.
    startedAt: timestamp("started_at"),
    checkedAt: timestamp("checked_at"),
    dismissedAt: timestamp("dismissed_at"),
    dismissedById: text("dismissed_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    versionUnique: unique("purchase_document_checks_version_unique").on(table.documentVersionId),
    invoiceFileUnique: unique("purchase_document_checks_invoice_file_unique").on(table.invoiceFileId),
    paymentUnique: unique("purchase_document_checks_payment_unique").on(table.paymentId),
    tenantStatusIdx: index("purchase_document_checks_tenant_status_idx").on(table.tenantId, table.status),
    tenantShaIdx: index("purchase_document_checks_tenant_sha_idx").on(table.tenantId, table.sha256),
    orderIdx: index("purchase_document_checks_order_idx").on(table.orderId),
    orderFk: foreignKey({
      name: "purchase_document_checks_order_id_tenant_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete("cascade"),
    documentVersionFk: foreignKey({
      name: "purchase_document_checks_document_version_id_tenant_fk",
      columns: [table.tenantId, table.documentVersionId],
      foreignColumns: [purchaseOrderDocumentVersions.tenantId, purchaseOrderDocumentVersions.id],
    }).onDelete("cascade"),
    invoiceFileFk: foreignKey({
      name: "purchase_document_checks_invoice_file_id_tenant_fk",
      columns: [table.tenantId, table.invoiceFileId],
      foreignColumns: [purchaseInvoiceFiles.tenantId, purchaseInvoiceFiles.id],
    }).onDelete("cascade"),
    paymentFk: foreignKey({
      name: "purchase_document_checks_payment_id_tenant_fk",
      columns: [table.tenantId, table.paymentId],
      foreignColumns: [purchasePayments.tenantId, purchasePayments.id],
    }).onDelete("cascade"),
    subjectCheck: check(
      "purchase_document_checks_subject_check",
      sql`num_nonnulls(${table.documentVersionId}, ${table.invoiceFileId}, ${table.paymentId}) = 1`,
    ),
    statusCheck: oneOf("purchase_document_checks_status_check", table.status, COLUMN_VALUES.purchaseCheckStatus),
  }),
);
