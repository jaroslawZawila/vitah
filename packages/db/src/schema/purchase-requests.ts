// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { COLUMN_VALUES, oneOf } from "./checks";
import { type PurchaseOrderKind, purchaseOrders, type PurchaseRequestStatus } from "./purchasing";
import { subcontractors } from "./subcontractors";
import { tenants } from "./tenants";
import { underProject } from "./under-project";
import { users } from "./users";

// What an obra asks to buy before there is an order: material or a
// subcontract for some budget lines, with an estimate, approved (or rejected)
// by an admin; an approved one becomes an order. Numbered per project (SOL-001).
export const purchaseRequests = pgTable(
  "purchase_requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    kind: text("kind").$type<PurchaseOrderKind>().notNull(),
    description: text("description").notNull(),
    // The day the obra needs it by.
    neededBy: date("needed_by", { mode: "string" }),
    // A supplier the obra suggests; the order may go to another.
    subcontractorId: text("subcontractor_id").references(() => subcontractors.id, { onDelete: "set null" }),
    notes: text("notes"),
    status: text("status").$type<PurchaseRequestStatus>().default("pending").notNull(),
    decidedById: text("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { mode: "date" }),
    // Why it was rejected (or a remark on approving it).
    decisionNote: text("decision_note"),
    // The order made from it.
    orderId: text("order_id").references(() => purchaseOrders.id, { onDelete: "set null" }),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectNumberUnique: unique("purchase_requests_project_number_unique").on(table.projectId, table.number),
    tenantStatusIdx: index("purchase_requests_tenant_status_idx").on(table.tenantId, table.status),
    // An order comes from one request at most.
    orderUnique: uniqueIndex("purchase_requests_order_unique").on(table.orderId).where(sql`${table.orderId} is not null`),
    tenantIdUnique: unique("purchase_requests_id_tenant_id_unique").on(table.id, table.tenantId),
    projectFk: underProject("purchase_requests_project_id_tenant_fk", table),
    kindCheck: oneOf("purchase_requests_kind_check", table.kind, COLUMN_VALUES.purchaseKind),
    statusCheck: oneOf("purchase_requests_status_check", table.status, COLUMN_VALUES.purchaseRequestStatus),
    numberCheck: check("purchase_requests_number_check", sql`${table.number} >= 1`),
  }),
);

// The budget lines (by lineage) a request asks for, with the estimate of each.
export const purchaseRequestLines = pgTable(
  "purchase_request_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    lineageId: text("lineage_id").notNull(),
    chapterCode: text("chapter_code").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (table) => ({
    requestLineageUnique: unique("purchase_request_lines_request_lineage_unique").on(table.requestId, table.lineageId),
    requestFk: foreignKey({
      name: "purchase_request_lines_request_id_tenant_fk",
      columns: [table.tenantId, table.requestId],
      foreignColumns: [purchaseRequests.tenantId, purchaseRequests.id],
    }).onDelete("cascade"),
    amountCheck: check("purchase_request_lines_amount_cents_check", sql`${table.amountCents} > 0`),
  }),
);

// Every change to a request: created, edited, approved, rejected, ordered, cancelled.
export const purchaseRequestEvents = pgTable(
  "purchase_request_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
    note: text("note"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    requestCreatedIdx: index("purchase_request_events_request_created_idx").on(table.requestId, table.createdAt),
    requestFk: foreignKey({
      name: "purchase_request_events_request_id_tenant_fk",
      columns: [table.tenantId, table.requestId],
      foreignColumns: [purchaseRequests.tenantId, purchaseRequests.id],
    }).onDelete("cascade"),
  }),
);
