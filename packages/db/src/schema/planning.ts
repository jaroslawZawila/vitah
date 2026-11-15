// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, integer, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { COLUMN_VALUES, inOrder, oneOf } from "./checks";
import { tenants } from "./tenants";
import { underProject } from "./under-project";
import { users } from "./users";

// --- Planning (the works schedule) ---

export type PlanningVersionStatus = (typeof COLUMN_VALUES.planningStatus)[number];

// A project's schedule, by version: a draft is edited freely; approving it makes
// it the baseline (the previous one superseded). One draft and one baseline at most.
export const planningVersions = pgTable(
  "planning_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    status: text("status").$type<PlanningVersionStatus>().default("draft").notNull(),
    // The day the works start (acta de inicio) and the working calendar.
    startDate: date("start_date", { mode: "string" }).notNull(),
    // An autonomous community's holidays (as, cb, cl, ga, md); null = national only.
    region: text("region"),
    augustClosure: boolean("august_closure").default(true).notNull(),
    christmasClosure: boolean("christmas_closure").default(true).notNull(),
    // Why it changed: required to approve a version after the first.
    reason: text("reason"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    approvedById: text("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { mode: "date" }),
  },
  (table) => ({
    projectNumberUnique: unique("planning_versions_project_number_unique").on(table.projectId, table.number),
    oneDraft: uniqueIndex("planning_versions_one_draft")
      .on(table.projectId)
      .where(sql`${table.status} = 'draft'`),
    oneApproved: uniqueIndex("planning_versions_one_approved")
      .on(table.projectId)
      .where(sql`${table.status} = 'approved'`),
    tenantIdUnique: unique("planning_versions_id_tenant_id_unique").on(table.id, table.tenantId),
    projectFk: underProject("planning_versions_project_id_tenant_fk", table),
    statusCheck: oneOf("planning_versions_status_check", table.status, COLUMN_VALUES.planningStatus),
    regionCheck: oneOf("planning_versions_region_check", table.region, COLUMN_VALUES.planningRegion),
    numberCheck: check("planning_versions_number_check", sql`${table.number} >= 1`),
  }),
);

// One row per contract chapter: what it waits for, how long it takes in working
// days, and the dates that gives (stored, so a baseline never moves).
export const planningItems = pgTable(
  "planning_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    versionId: text("version_id").notNull(),
    chapterCode: text("chapter_code").notNull(),
    position: integer("position").notNull(),
    // Starts the working day after this chapter ends (+ lag); null = at `fixed_start` or the works' start.
    afterCode: text("after_code"),
    lagDays: integer("lag_days").default(0).notNull(),
    durationDays: integer("duration_days").notNull(),
    fixedStart: date("fixed_start", { mode: "string" }),
    // Runs through the whole works (quality control, health and safety, waste).
    spansWorks: boolean("spans_works").default(false).notNull(),
    // Calendar days before its start its orders must be placed (suppliers' lead time).
    leadDays: integer("lead_days").default(0).notNull(),
    plannedStart: date("planned_start", { mode: "string" }).notNull(),
    plannedEnd: date("planned_end", { mode: "string" }).notNull(),
  },
  (table) => ({
    versionChapterUnique: unique("planning_items_version_chapter_unique").on(table.versionId, table.chapterCode),
    // Cascaded: a draft plan is deleted for real.
    versionFk: foreignKey({
      name: "planning_items_version_id_tenant_fk",
      columns: [table.tenantId, table.versionId],
      foreignColumns: [planningVersions.tenantId, planningVersions.id],
    }).onDelete("cascade"),
    daysCheck: check("planning_items_days_check", sql`${table.durationDays} >= 1 and ${table.leadDays} >= 0`),
    datesCheck: inOrder("planning_items_dates_check", table.plannedStart, table.plannedEnd),
  }),
);
