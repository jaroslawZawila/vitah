-- The tenant's library of "Gastos no incluidos" (packages/core/src/budget-exclusions.ts):
-- the standard lines a budget may exclude, ticked per budget on its Condiciones
-- page. Additive: one new table, read only by the new code; the previous
-- deployment never touches it. A tenant's lines are written from the template
-- the first time its library is read, so nothing is inserted here. Run it before
-- the code goes live (the Condiciones page reads the table). Safe to run twice.

-- The foreign keys lock tenants and users briefly: never queue the portal behind this file.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "budget_exclusion_presets" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "label" text NOT NULL,
  "position" integer NOT NULL,
  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp,
  "deleted_by_id" text REFERENCES "users"("id") ON DELETE set null,
  CONSTRAINT "budget_exclusion_presets_label_check" CHECK (length(btrim(label)) > 0),
  CONSTRAINT "budget_exclusion_presets_deleted_check" CHECK (deleted_by_id IS NULL OR deleted_at IS NOT NULL)
);
-- One line of each text among those not deleted (by its hash: a line may be longer than an index entry).
CREATE UNIQUE INDEX IF NOT EXISTS "budget_exclusion_presets_tenant_label_unique"
  ON "budget_exclusion_presets" ("tenant_id", md5("label")) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "budget_exclusion_presets_tenant_position_idx" ON "budget_exclusion_presets" ("tenant_id", "position");
