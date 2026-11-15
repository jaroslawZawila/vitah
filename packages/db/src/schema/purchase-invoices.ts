// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { COLUMN_VALUES, deletedTogether, inOrder, oneOf } from "./checks";
import { type PurchaseInvoiceKind, purchaseOrderMilestones, purchaseOrders, type PurchasePaymentMethod, type PurchaseVatKind } from "./purchasing";
import { subcontractors } from "./subcontractors";
import { tenants } from "./tenants";
import { users } from "./users";

// A supplier's invoice (or credit note) for an order, registered once by
// Administration. Its amounts are as invoiced: the base (without VAT) is what
// is compared with the budget's cost; what is paid is the total less the
// guarantee retention. A credit note rectifies one invoice and has a negative base.
export const purchaseInvoices = pgTable(
  "purchase_invoices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    // The order's supplier, kept here so each supplier's numbers stay unique.
    subcontractorId: text("subcontractor_id").notNull(),
    kind: text("kind").$type<PurchaseInvoiceKind>().default("invoice").notNull(),
    // The supplier's own number.
    number: text("number").notNull(),
    // An invoiced milestone is never removed: not cascaded.
    milestoneId: text("milestone_id"),
    rectifiesId: text("rectifies_id"),
    issuedOn: date("issued_on", { mode: "string" }).notNull(),
    // None for a credit note: it settles against the invoice it rectifies.
    dueOn: date("due_on", { mode: "string" }),
    baseCents: integer("base_cents").notNull(),
    vatKind: text("vat_kind").$type<PurchaseVatKind>().notNull(),
    vatCents: integer("vat_cents").notNull(),
    // Income tax withheld from a self-employed supplier.
    irpfBp: integer("irpf_bp").default(0).notNull(),
    irpfCents: integer("irpf_cents").default(0).notNull(),
    // The guarantee held back until the works' guarantee ends.
    retentionBp: integer("retention_bp").default(0).notNull(),
    retentionCents: integer("retention_cents").default(0).notNull(),
    notes: text("notes"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    // Soft delete: set when a user deletes it. The row and its files stay; every read leaves it out.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedById: text("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    // Among the invoices not deleted: a deleted one doesn't keep its number taken.
    supplierNumberUnique: uniqueIndex("purchase_invoices_supplier_number_unique")
      .on(table.tenantId, table.subcontractorId, table.number)
      .where(sql`${table.deletedAt} is null`),
    orderIdx: index("purchase_invoices_order_idx").on(table.orderId),
    tenantDueIdx: index("purchase_invoices_tenant_due_idx").on(table.tenantId, table.dueOn),
    // A credit note's invoice: settling an invoice reads its credit notes.
    rectifiesIdx: index("purchase_invoices_rectifies_idx").on(table.rectifiesId),
    tenantIdUnique: unique("purchase_invoices_id_tenant_id_unique").on(table.id, table.tenantId),
    orderFk: foreignKey({
      name: "purchase_invoices_order_id_tenant_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete("cascade"),
    subcontractorFk: foreignKey({
      name: "purchase_invoices_subcontractor_id_tenant_fk",
      columns: [table.tenantId, table.subcontractorId],
      foreignColumns: [subcontractors.tenantId, subcontractors.id],
    }),
    milestoneFk: foreignKey({
      name: "purchase_invoices_milestone_id_tenant_fk",
      columns: [table.tenantId, table.milestoneId],
      foreignColumns: [purchaseOrderMilestones.tenantId, purchaseOrderMilestones.id],
    }),
    rectifiesFk: foreignKey({
      name: "purchase_invoices_rectifies_id_tenant_fk",
      columns: [table.tenantId, table.rectifiesId],
      foreignColumns: [table.tenantId, table.id],
    }),
    // An invoice has a positive base; a credit note a negative one, rectifies an invoice and is never due itself.
    kindCheck: check(
      "purchase_invoices_kind_check",
      sql`(${table.kind} = 'invoice' and ${table.baseCents} > 0 and ${table.rectifiesId} is null) or (${table.kind} = 'credit_note' and ${table.baseCents} < 0 and ${table.rectifiesId} is not null and ${table.dueOn} is null)`,
    ),
    vatKindCheck: oneOf("purchase_invoices_vat_kind_check", table.vatKind, COLUMN_VALUES.purchaseVatKind),
    ratesCheck: check(
      "purchase_invoices_rates_check",
      sql`${table.irpfBp} between 0 and 10000 and ${table.retentionBp} between 0 and 10000`,
    ),
    datesCheck: inOrder("purchase_invoices_dates_check", table.issuedOn, table.dueOn),
    deletedCheck: deletedTogether("purchase_invoices_deleted_check", table),
  }),
);

// How an invoice's base splits across its order's budget lines (by lineage).
export const purchaseInvoiceLines = pgTable(
  "purchase_invoice_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id").notNull(),
    lineageId: text("lineage_id").notNull(),
    chapterCode: text("chapter_code").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (table) => ({
    invoiceLineageUnique: unique("purchase_invoice_lines_invoice_lineage_unique").on(table.invoiceId, table.lineageId),
    invoiceFk: foreignKey({
      name: "purchase_invoice_lines_invoice_id_tenant_fk",
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [purchaseInvoices.tenantId, purchaseInvoices.id],
    }).onDelete("cascade"),
    // Its invoice's sign: negative on a credit note.
    amountCheck: check("purchase_invoice_lines_amount_cents_check", sql`${table.amountCents} <> 0`),
  }),
);

// An invoice's PDF, versioned: a new upload adds a version, none is deleted.
export const purchaseInvoiceFiles = pgTable(
  "purchase_invoice_files",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id").notNull(),
    version: integer("version").notNull(),
    pathname: text("pathname").unique().notNull(),
    filename: text("filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Why it replaced the previous version.
    note: text("note"),
    uploadedById: text("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    invoiceVersionUnique: unique("purchase_invoice_files_invoice_version_unique").on(table.invoiceId, table.version),
    tenantCreatedIdx: index("purchase_invoice_files_tenant_created_idx").on(table.tenantId, table.createdAt),
    tenantIdUnique: unique("purchase_invoice_files_id_tenant_id_unique").on(table.id, table.tenantId),
    invoiceFk: foreignKey({
      name: "purchase_invoice_files_invoice_id_tenant_fk",
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [purchaseInvoices.tenantId, purchaseInvoices.id],
    }).onDelete("cascade"),
    versionCheck: check("purchase_invoice_files_version_check", sql`${table.version} >= 1 and ${table.sizeBytes} >= 0`),
  }),
);

// A payment of an invoice: partial ones add up; past the amount due, the
// retention is being released.
export const purchasePayments = pgTable(
  "purchase_payments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id").notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: text("method").$type<PurchasePaymentMethod>().notNull(),
    reference: text("reference"),
    // The proof of payment (PDF, private Blob store).
    fileName: text("file_name"),
    filePathname: text("file_pathname"),
    fileSizeBytes: integer("file_size_bytes"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    // Soft delete: set when a user deletes it. The row and its files stay; every read leaves it out.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedById: text("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    invoiceIdx: index("purchase_payments_invoice_idx").on(table.invoiceId),
    tenantPaidIdx: index("purchase_payments_tenant_paid_idx").on(table.tenantId, table.paidOn),
    tenantCreatedIdx: index("purchase_payments_tenant_created_idx").on(table.tenantId, table.createdAt),
    tenantIdUnique: unique("purchase_payments_id_tenant_id_unique").on(table.id, table.tenantId),
    invoiceFk: foreignKey({
      name: "purchase_payments_invoice_id_tenant_fk",
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [purchaseInvoices.tenantId, purchaseInvoices.id],
    }).onDelete("cascade"),
    amountCheck: check(
      "purchase_payments_amount_cents_check",
      sql`${table.amountCents} > 0 and ${table.fileSizeBytes} >= 0`,
    ),
    methodCheck: oneOf("purchase_payments_method_check", table.method, COLUMN_VALUES.purchasePaymentMethod),
    deletedCheck: deletedTogether("purchase_payments_deleted_check", table),
  }),
);
