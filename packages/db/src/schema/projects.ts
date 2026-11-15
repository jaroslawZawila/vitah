// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { COLUMN_RANGES, deletedTogether, inOrder, within } from "./checks";
import { tenants } from "./tenants";
import { users } from "./users";

// --- Projects ---

export const projects = pgTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    // Full address of the home.
    address: text("address").notNull(),
    startDate: timestamp("start_date", { mode: "date" }),
    completionDate: timestamp("completion_date", { mode: "date" }),
    // Stage of the construction process, 1–8 (features/construction_process/
    // PROCESS.md §2): set by staff on the project's Obra page.
    obraStage: integer("obra_stage").default(1).notNull(),
    // Construction control: the accepted budget revision whose added and
    // removed chapters staff have reviewed (null: none reviewed yet).
    obraReviewedRevisionId: text("obra_reviewed_revision_id"),
    // Homeowner with mobile app access. A client may have several projects
    // (packages/core/src/client-projects.ts).
    clientUserId: text("client_user_id").references(() => users.id, { onDelete: "set null" }),
    // Change counters the client's open app polls (packages/core/src/changes.ts):
    // each goes up after a write to that part of the app.
    projectRev: integer("project_rev").default(0).notNull(),
    obraRev: integer("obra_rev").default(0).notNull(),
    photosRev: integer("photos_rev").default(0).notNull(),
    documentsRev: integer("documents_rev").default(0).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
    // Soft delete: set when a user deletes it. The row and its files stay; every read leaves it out.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedById: text("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    // Among the projects not deleted: a deleted one doesn't keep its ref taken.
    tenantRefUnique: uniqueIndex("projects_tenant_ref_unique")
      .on(table.tenantId, table.ref)
      .where(sql`${table.deletedAt} is null`),
    clientUserIdx: index("projects_client_user_idx").on(table.clientUserId),
    // What everything under a project references: (tenant_id, project_id), so no
    // row can hang under another tenant's project.
    tenantIdUnique: unique("projects_id_tenant_id_unique").on(table.id, table.tenantId),
    obraStageCheck: within("projects_obra_stage_check", table.obraStage, COLUMN_RANGES.obraStage),
    datesCheck: inOrder("projects_dates_check", table.startDate, table.completionDate),
    deletedCheck: deletedTogether("projects_deleted_check", table),
  }),
);
