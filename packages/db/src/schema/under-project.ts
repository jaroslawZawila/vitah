// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { type AnyPgColumn, foreignKey } from "drizzle-orm/pg-core";
import { projects } from "./projects";

/**
 * A row under a project: `(tenant_id, project_id)` references the project's
 * `(tenant_id, id)`. Never cascaded: deleting a project is a soft delete in the
 * application, so a hand-run `DELETE FROM projects` on one with anything under
 * it is refused by the database (NO ACTION: checked at the end of the
 * statement, so deleting a whole tenant, whose cascade takes the project and
 * its rows together, still works).
 */
export const underProject = (name: string, table: { tenantId: AnyPgColumn; projectId: AnyPgColumn }) =>
  foreignKey({ name, columns: [table.tenantId, table.projectId], foreignColumns: [projects.tenantId, projects.id] });
