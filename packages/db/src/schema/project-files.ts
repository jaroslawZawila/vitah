// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { budgetRevisions } from "./budget";
import { COLUMN_VALUES, deletedTogether, notNegative, oneOf } from "./checks";
import { documentCategoryEnum } from "./enums";
import { tenants } from "./tenants";
import { underProject } from "./under-project";
import { users } from "./users";

// --- Project documents ---

// A PDF shared with the project's client. The file lives in a private Vercel
// Blob store under `pathname`; it is only ever served through our API.
export const projectDocuments = pgTable(
  "project_documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    category: documentCategoryEnum("category").notNull(),
    pathname: text("pathname").unique().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Whether the project's client sees it in the app. Budget inputs and the
    // detailed budget PDF are staff-only by default.
    visibleToClient: boolean("visible_to_client").default(true).notNull(),
    contentType: text("content_type").default("application/pdf").notNull(),
    // The uploaded file's own name (budget inputs can be BC3 or spreadsheets).
    filename: text("filename"),
    // Set on the documents a budget was generated from: plans | basic | execution | measurements.
    budgetInput: text("budget_input").$type<(typeof COLUMN_VALUES.budgetInput)[number]>(),
    // Set on the PDFs of an issued budget revision: general | detailed.
    budgetRevisionId: text("budget_revision_id").references(() => budgetRevisions.id, {
      onDelete: "set null",
    }),
    budgetPdf: text("budget_pdf").$type<(typeof COLUMN_VALUES.budgetPdf)[number]>(),
    // When the client was first pushed about it: once only, however often it
    // is hidden and shown again. Null while it was never visible.
    clientNotifiedAt: timestamp("client_notified_at", { mode: "date" }),
    // The file's id in Claude's Files API, reused across generations.
    claudeFileId: text("claude_file_id"),
    uploadedById: text("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
    // Soft delete: set when a user deletes it. The row and its files stay; every read leaves it out.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedById: text("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    projectIdx: index("project_documents_project_idx").on(table.projectId),
    projectFk: underProject("project_documents_project_id_tenant_fk", table),
    budgetInputCheck: oneOf("project_documents_budget_input_check", table.budgetInput, COLUMN_VALUES.budgetInput),
    budgetPdfCheck: oneOf("project_documents_budget_pdf_check", table.budgetPdf, COLUMN_VALUES.budgetPdf),
    sizeCheck: notNegative("project_documents_size_bytes_check", table.sizeBytes),
    deletedCheck: deletedTogether("project_documents_deleted_check", table),
  }),
);

// --- Project photos ---

// A site photo shared with the project's client (JPEG, PNG or WebP) unless
// staff hide it. Stored like documents: private Blob store, only served
// through our API.
export const projectPhotos = pgTable(
  "project_photos",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    caption: text("caption"),
    pathname: text("pathname").unique().notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Budget chapter the photo shows (e.g. "05"), if any: the photo then also
    // appears on that chapter and on its phase in the app.
    chapterCode: text("chapter_code"),
    // The day the photo was taken (staff may set it); null: its upload day.
    takenOn: date("taken_on", { mode: "string" }),
    // Size of the small copy for grids, stored next to the photo as
    // "<id>.thumb.webp". Null for photos uploaded before thumbnails existed.
    thumbSizeBytes: integer("thumb_size_bytes"),
    // Whether the project's client sees it in the app; staff may hide one.
    visibleToClient: boolean("visible_to_client").default(true).notNull(),
    // As on documents: when the client was first pushed about it.
    clientNotifiedAt: timestamp("client_notified_at", { mode: "date" }),
    uploadedById: text("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
    // Soft delete: set when a user deletes it. The row and its files stay; every read leaves it out.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedById: text("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    projectIdx: index("project_photos_project_idx").on(table.projectId),
    // Hitos pick photos by (tenant_id, photo_id).
    tenantIdUnique: unique("project_photos_id_tenant_id_unique").on(table.id, table.tenantId),
    projectFk: underProject("project_photos_project_id_tenant_fk", table),
    sizeCheck: check("project_photos_size_bytes_check", sql`${table.sizeBytes} >= 0 and ${table.thumbSizeBytes} >= 0`),
    deletedCheck: deletedTogether("project_photos_deleted_check", table),
  }),
);
