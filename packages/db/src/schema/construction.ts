// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { COLUMN_VALUES, deletedTogether, notNegative, oneOf } from "./checks";
import { obraHitos } from "./hitos";
import { tenants } from "./tenants";
import { underProject } from "./under-project";
import { users } from "./users";

// --- Obra: construction control ---
// The technical follow-up of a project's works (features/construction_control):
// when each budget chapter of the contract really started and finished, every
// such record and correction, the invoice requests that finishing a hito's
// last chapter creates, and a log of issues and changes. Chapters are matched
// by code, so the records hold across budget revisions. Staff only.

// One chapter's actual dates: none = pending, a start = in progress, both = finished.
export const obraChapterProgress = pgTable(
  "obra_chapter_progress",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    chapterCode: text("chapter_code").notNull(),
    actualStart: date("actual_start", { mode: "string" }),
    actualEnd: date("actual_end", { mode: "string" }),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectChapterUnique: unique("obra_chapter_progress_project_chapter_unique").on(
      table.projectId,
      table.chapterCode,
    ),
    projectFk: underProject("obra_chapter_progress_project_id_tenant_fk", table),
    // Finished only once started, and never before it started.
    datesCheck: check(
      "obra_chapter_progress_dates_check",
      sql`${table.actualEnd} is null or (${table.actualStart} is not null and ${table.actualEnd} >= ${table.actualStart})`,
    ),
  }),
);

// Every recorded date and correction: the day the work happened, and who recorded it when.
export const obraProgressEvents = pgTable(
  "obra_progress_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    chapterCode: text("chapter_code").notNull(),
    // start | finish | correct_start | correct_finish
    kind: text("kind").$type<(typeof COLUMN_VALUES.progressEventKind)[number]>().notNull(),
    // The date before and after (null: none, or cleared).
    previousDate: date("previous_date", { mode: "string" }),
    newDate: date("new_date", { mode: "string" }),
    note: text("note"),
    recordedById: text("recorded_by_id").references(() => users.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    projectIdx: index("obra_progress_events_project_idx").on(table.projectId, table.recordedAt),
    projectFk: underProject("obra_progress_events_project_id_tenant_fk", table),
    kindCheck: oneOf("obra_progress_events_kind_check", table.kind, COLUMN_VALUES.progressEventKind),
  }),
);

// The request to Administration to invoice a hito, made once when its last chapter finishes.
export const obraInvoiceRequests = pgTable(
  "obra_invoice_requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    // Unique: never a second request for the same hito.
    hitoId: text("hito_id").notNull().unique("obra_invoice_requests_hito_unique"),
    // The chapter whose finish met the hito.
    chapterCode: text("chapter_code").notNull(),
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    clientName: text("client_name"),
    requestedById: text("requested_by_id").references(() => users.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    projectFk: underProject("obra_invoice_requests_project_id_tenant_fk", table),
    hitoFk: foreignKey({
      name: "obra_invoice_requests_hito_id_tenant_fk",
      columns: [table.tenantId, table.hitoId],
      foreignColumns: [obraHitos.tenantId, obraHitos.id],
    }).onDelete("cascade"),
    amountCheck: notNegative("obra_invoice_requests_amount_cents_check", table.amountCents),
  }),
);

// Every change to a hito's collection from the client: its acta and invoice
// uploaded, replaced or removed, its payment registered, corrected or
// cancelled, with what was there before. Append-only: rows are never updated
// or deleted (a replaced or removed PDF stays in storage, its pathname here).
export const obraHitoEvents = pgTable(
  "obra_hito_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    hitoId: text("hito_id").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").$type<(typeof COLUMN_VALUES.hitoEventAction)[number]>().notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    hitoIdx: index("obra_hito_events_hito_idx").on(table.hitoId),
    tenantIdx: index("obra_hito_events_tenant_idx").on(table.tenantId),
    projectFk: underProject("obra_hito_events_project_id_tenant_fk", table),
    hitoFk: foreignKey({
      name: "obra_hito_events_hito_id_tenant_fk",
      columns: [table.tenantId, table.hitoId],
      foreignColumns: [obraHitos.tenantId, obraHitos.id],
    }).onDelete("cascade"),
    actionCheck: oneOf("obra_hito_events_action_check", table.action, COLUMN_VALUES.hitoEventAction),
  }),
);

// A problem during the works (issue) or a difference from what was planned (change).
export const obraIssues = pgTable(
  "obra_issues",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    // issue | change; numbered per project and kind (INC-007, CAM-004).
    kind: text("kind").$type<(typeof COLUMN_VALUES.issueKind)[number]>().notNull(),
    number: integer("number").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    chapterCode: text("chapter_code").notNull(),
    description: text("description").notNull(),
    // client | subcontractor | own | other
    party: text("party").$type<(typeof COLUMN_VALUES.issueParty)[number]>().notNull(),
    partyName: text("party_name"),
    // Estimates, never required: they may not be known yet.
    costImpactCents: integer("cost_impact_cents"),
    scheduleImpactDays: integer("schedule_impact_days"),
    // pending | review | resolved
    status: text("status").$type<(typeof COLUMN_VALUES.issueStatus)[number]>().default("pending").notNull(),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectKindNumberUnique: unique("obra_issues_project_kind_number_unique").on(
      table.projectId,
      table.kind,
      table.number,
    ),
    tenantIdUnique: unique("obra_issues_id_tenant_id_unique").on(table.id, table.tenantId),
    projectFk: underProject("obra_issues_project_id_tenant_fk", table),
    kindCheck: oneOf("obra_issues_kind_check", table.kind, COLUMN_VALUES.issueKind),
    partyCheck: oneOf("obra_issues_party_check", table.party, COLUMN_VALUES.issueParty),
    statusCheck: oneOf("obra_issues_status_check", table.status, COLUMN_VALUES.issueStatus),
    numberCheck: check("obra_issues_number_check", sql`${table.number} >= 1`),
  }),
);

// A photo, email or document supporting an issue (private Blob store).
export const obraIssueFiles = pgTable(
  "obra_issue_files",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    issueId: text("issue_id").notNull(),
    filename: text("filename").notNull(),
    pathname: text("pathname").unique().notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedById: text("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    // Soft delete: set when a user deletes it. The row and its files stay; every read leaves it out.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedById: text("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    issueIdx: index("obra_issue_files_issue_idx").on(table.issueId),
    issueFk: foreignKey({
      name: "obra_issue_files_issue_id_tenant_fk",
      columns: [table.tenantId, table.issueId],
      foreignColumns: [obraIssues.tenantId, obraIssues.id],
    }).onDelete("cascade"),
    sizeCheck: notNegative("obra_issue_files_size_bytes_check", table.sizeBytes),
    deletedCheck: deletedTogether("obra_issue_files_deleted_check", table),
  }),
);
