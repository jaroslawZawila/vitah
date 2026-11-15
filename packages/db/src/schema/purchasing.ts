// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { COLUMN_VALUES, deletedTogether, inOrder, oneOf, sqlList } from "./checks";
import { subcontractors } from "./subcontractors";
import { tenants } from "./tenants";
import { underProject } from "./under-project";
import { users } from "./users";

// --- Purchasing (Compras) ---

// The orders of material and the subcontracts of a project, each split across
// budget lines (by lineage, so they outlive a budget revision). What they
// contract is what the Obra tab compares with the budget's cost. Staff only.

export type PurchaseOrderKind = (typeof COLUMN_VALUES.purchaseKind)[number];
// material: pending → ordered → confirmed → in_transit → delivered;
// subcontract: pending → contracted → finished; either may be cancelled.
export type PurchaseOrderStatus =
  | (typeof COLUMN_VALUES.purchaseMaterialStatus)[number]
  | (typeof COLUMN_VALUES.purchaseSubcontractStatus)[number];
// The VAT a supplier's invoice carries: 21 %, 10 %, reverse charge (a
// subcontract between contractors, art. 84 LIVA) or exempt.
export type PurchaseVatKind = (typeof COLUMN_VALUES.purchaseVatKind)[number];
export type PurchaseInvoiceKind = (typeof COLUMN_VALUES.purchaseInvoiceKind)[number];
// A purchase request: pending (waiting for approval) → approved → ordered
// (an order was made from it); or rejected (with a reason) or cancelled.
export type PurchaseRequestStatus = (typeof COLUMN_VALUES.purchaseRequestStatus)[number];
export type PurchasePaymentMethod = (typeof COLUMN_VALUES.purchasePaymentMethod)[number];

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    // Numbered per project (PED-001).
    number: integer("number").notNull(),
    kind: text("kind").$type<PurchaseOrderKind>().notNull(),
    // Not cascaded (a company with orders is never deleted), yet a deleted tenant takes both.
    subcontractorId: text("subcontractor_id").notNull(),
    description: text("description").notNull(),
    status: text("status").$type<PurchaseOrderStatus>().default("pending").notNull(),
    orderedOn: date("ordered_on", { mode: "string" }),
    // A material order's expected delivery; a subcontract's works period.
    expectedOn: date("expected_on", { mode: "string" }),
    workStart: date("work_start", { mode: "string" }),
    workEnd: date("work_end", { mode: "string" }),
    // Delivered (material) or finished (subcontract).
    completedOn: date("completed_on", { mode: "string" }),
    notes: text("notes"),
    // What its invoices start from: days to pay them (null: the default 30),
    // the guarantee retention, and their VAT (null: by kind).
    paymentDays: integer("payment_days"),
    retentionBp: integer("retention_bp").default(0).notNull(),
    vatKind: text("vat_kind").$type<PurchaseVatKind>(),
    // Legacy: the order's single PDF before it had documents
    // (purchase_order_documents); copied there by 2026-10-purchase-documents.sql.
    fileName: text("file_name"),
    filePathname: text("file_pathname"),
    fileSizeBytes: integer("file_size_bytes"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectNumberUnique: unique("purchase_orders_project_number_unique").on(table.projectId, table.number),
    tenantIdx: index("purchase_orders_tenant_idx").on(table.tenantId),
    subcontractorIdx: index("purchase_orders_subcontractor_idx").on(table.subcontractorId),
    tenantIdUnique: unique("purchase_orders_id_tenant_id_unique").on(table.id, table.tenantId),
    projectFk: underProject("purchase_orders_project_id_tenant_fk", table),
    subcontractorFk: foreignKey({
      name: "purchase_orders_subcontractor_id_tenant_fk",
      columns: [table.tenantId, table.subcontractorId],
      foreignColumns: [subcontractors.tenantId, subcontractors.id],
    }),
    kindCheck: oneOf("purchase_orders_kind_check", table.kind, COLUMN_VALUES.purchaseKind),
    // Only its own kind's flow: a kind changes only while pending (core purchasing.ts).
    statusCheck: check(
      "purchase_orders_status_check",
      sql`(${table.kind} = 'material' and ${table.status} in (${sqlList(COLUMN_VALUES.purchaseMaterialStatus)})) or (${table.kind} = 'subcontract' and ${table.status} in (${sqlList(COLUMN_VALUES.purchaseSubcontractStatus)}))`,
    ),
    vatKindCheck: oneOf("purchase_orders_vat_kind_check", table.vatKind, COLUMN_VALUES.purchaseVatKind),
    numberCheck: check("purchase_orders_number_check", sql`${table.number} >= 1`),
    termsCheck: check(
      "purchase_orders_terms_check",
      sql`${table.paymentDays} >= 0 and ${table.retentionBp} between 0 and 10000 and ${table.fileSizeBytes} >= 0`,
    ),
    workDatesCheck: inOrder("purchase_orders_work_dates_check", table.workStart, table.workEnd),
  }),
);

// How much of an order goes to a budget line, and whether it closes the line
// (nothing else is left to contract for it).
export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    // budget_lines.lineage_id: the same line in every revision.
    lineageId: text("lineage_id").notNull(),
    chapterCode: text("chapter_code").notNull(),
    amountCents: integer("amount_cents").notNull(),
    closesLine: boolean("closes_line").default(true).notNull(),
  },
  (table) => ({
    orderLineageUnique: unique("purchase_order_lines_order_lineage_unique").on(table.orderId, table.lineageId),
    orderFk: foreignKey({
      name: "purchase_order_lines_order_id_tenant_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete("cascade"),
    amountCheck: check("purchase_order_lines_amount_cents_check", sql`${table.amountCents} > 0`),
  }),
);

// Every change to an order: its creation, status, dates, amounts and lines.
export const purchaseOrderEvents = pgTable(
  "purchase_order_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    // created | status | updated | lines | file_added | file_removed
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
    note: text("note"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    orderCreatedIdx: index("purchase_order_events_order_created_idx").on(table.orderId, table.createdAt),
    orderFk: foreignKey({
      name: "purchase_order_events_order_id_tenant_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete("cascade"),
  }),
);

// An order's documents (the order, the signed contract, its annexes, the
// offer…), each a PDF in versions: a new upload adds one, the last is current.
export const purchaseOrderDocuments = pgTable(
  "purchase_order_documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    title: text("title").notNull(),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    // Soft delete: set when a user deletes it. The row and its files stay; every read leaves it out.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedById: text("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    orderIdx: index("purchase_order_documents_order_idx").on(table.orderId),
    tenantIdUnique: unique("purchase_order_documents_id_tenant_id_unique").on(table.id, table.tenantId),
    orderFk: foreignKey({
      name: "purchase_order_documents_order_id_tenant_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete("cascade"),
    deletedCheck: deletedTogether("purchase_order_documents_deleted_check", table),
  }),
);

// A document's file, immutable once stored; `note` says why it replaced the previous one.
export const purchaseOrderDocumentVersions = pgTable(
  "purchase_order_document_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull(),
    version: integer("version").notNull(),
    pathname: text("pathname").unique().notNull(),
    filename: text("filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    note: text("note"),
    uploadedById: text("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    documentVersionUnique: unique("purchase_order_document_versions_document_version_unique").on(
      table.documentId,
      table.version,
    ),
    tenantCreatedIdx: index("purchase_order_document_versions_tenant_created_idx").on(table.tenantId, table.createdAt),
    tenantIdUnique: unique("purchase_order_document_versions_id_tenant_id_unique").on(table.id, table.tenantId),
    documentFk: foreignKey({
      name: "purchase_order_document_versions_document_id_tenant_fk",
      columns: [table.tenantId, table.documentId],
      foreignColumns: [purchaseOrderDocuments.tenantId, purchaseOrderDocuments.id],
    }).onDelete("cascade"),
    versionCheck: check(
      "purchase_order_document_versions_version_check",
      sql`${table.version} >= 1 and ${table.sizeBytes} >= 0`,
    ),
  }),
);

// A contract's payment schedule: how its amount is invoiced, in turn. They
// split what the order contracts, never add to it.
export const purchaseOrderMilestones = pgTable(
  "purchase_order_milestones",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    position: integer("position").notNull(),
    concept: text("concept").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (table) => ({
    orderIdx: index("purchase_order_milestones_order_idx").on(table.orderId),
    tenantIdUnique: unique("purchase_order_milestones_id_tenant_id_unique").on(table.id, table.tenantId),
    orderFk: foreignKey({
      name: "purchase_order_milestones_order_id_tenant_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete("cascade"),
    amountCheck: check("purchase_order_milestones_amount_cents_check", sql`${table.amountCents} > 0`),
  }),
);

// A placed order's formal modification (modificado nº 1, 2…): what changed in
// its lines, signed on a day for a reason, maybe with its signed PDF (one of
// the order's documents). The order's lines are the current ones; each
// amendment keeps the amounts before and after and the lines it changed.
export const purchaseOrderAmendments = pgTable(
  "purchase_order_amendments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    number: integer("number").notNull(),
    concept: text("concept").notNull(),
    signedOn: date("signed_on", { mode: "string" }).notNull(),
    amountBeforeCents: integer("amount_before_cents").notNull(),
    amountAfterCents: integer("amount_after_cents").notNull(),
    // [{ code, lineageId, from: { amountCents, closesLine } | null, to: … | null }]
    changes: jsonb("changes").$type<Record<string, unknown>[]>().default([]).notNull(),
    documentId: text("document_id").references(() => purchaseOrderDocuments.id, { onDelete: "set null" }),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orderNumberUnique: unique("purchase_order_amendments_order_number_unique").on(table.orderId, table.number),
    orderFk: foreignKey({
      name: "purchase_order_amendments_order_id_tenant_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete("cascade"),
    numberCheck: check("purchase_order_amendments_number_check", sql`${table.number} >= 1`),
  }),
);
