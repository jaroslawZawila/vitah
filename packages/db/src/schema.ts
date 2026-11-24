// The database schema (Drizzle), by module in ./schema/. This file is its entry
// (`@repo/db/schema`): drizzle-kit (drizzle.config.ts, so `db:push`, the test
// databases and `db:drift`), the client and the seed all read the tables from
// here, so a new module must be re-exported below.

// --- What the database enforces ---
// Production gets the same constraints from packages/db/sql/2026-11-15-1000-check-constraints.sql,
// 2026-11-15-1010-tenant-composite-keys.sql and 2026-11-15-1020-project-fk-no-cascade.sql
// (packages/db/test/integrity-migrations.test.ts proves they end where this file does).
//
// Tenant-composite keys: a row that carries tenant_id references its parent by
// (tenant_id, <parent>_id), so it can never hang under another tenant's row. Each
// parent has UNIQUE (id, tenant_id) for them, declared in the table's column order:
// drizzle-kit reads a constraint's columns in that order, and one it reads
// differently it drops and adds on every push, which fails once keys depend on it.
// It reads a composite foreign key's two sides each in its own table's order, so
// `db:push` on an existing database still drops and adds those keys every time:
// noisy, harmless.

export { COLUMN_RANGES, COLUMN_VALUES } from "./schema/checks";
export * from "./schema/enums";
export * from "./schema/tenants";
export * from "./schema/users";
export * from "./schema/projects";
export * from "./schema/project-files";
export * from "./schema/budget";
export * from "./schema/budget-approvals";
export * from "./schema/budget-exclusions";
export * from "./schema/hitos";
export * from "./schema/construction";
export * from "./schema/ai";
export * from "./schema/subcontractors";
export * from "./schema/purchasing";
export * from "./schema/purchase-requests";
export * from "./schema/purchase-invoices";
export * from "./schema/purchase-checks";
export * from "./schema/planning";
export * from "./schema/idempotency";
export * from "./schema/warranty";
export * from "./schema/relations";
