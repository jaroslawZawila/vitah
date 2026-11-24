// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { deletedTogether } from "./checks";
import { tenants } from "./tenants";
import { users } from "./users";

// --- The tenant's library of "Gastos no incluidos" ---
// The standard lines a budget may exclude (geotechnical study, licences…),
// ticked per budget on its Condiciones page. A budget keeps its own copy of
// the lines it ticked (budget_revisions.texts.exclusions), so editing or
// deleting a line here never changes a budget. A tenant starts from the
// template's lines (core's DEFAULT_EXCLUSIONS), written the first time its
// library is read.
export const budgetExclusionPresets = pgTable(
  "budget_exclusion_presets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // The line as the PDF prints it.
    label: text("label").notNull(),
    // Its place in the checklist (ties: the older first).
    position: integer("position").notNull(),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    // Soft delete: set when a user deletes it. The row stays; every read leaves it out.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedById: text("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    // One line of each text among those not deleted (by its hash: a line may be longer than an index entry).
    tenantLabelUnique: uniqueIndex("budget_exclusion_presets_tenant_label_unique")
      .on(table.tenantId, sql`md5(${table.label})`)
      .where(sql`${table.deletedAt} is null`),
    tenantPositionIdx: index("budget_exclusion_presets_tenant_position_idx").on(table.tenantId, table.position),
    labelCheck: check("budget_exclusion_presets_label_check", sql`length(btrim(${table.label})) > 0`),
    deletedCheck: deletedTogether("budget_exclusion_presets_deleted_check", table),
  }),
);
