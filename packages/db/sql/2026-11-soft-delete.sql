-- Prod migration: deletes become soft. What a user deletes (a project, a
-- project document or photo, an incident's file, a subcontractor's assignment
-- to an obra, an order's document, a supplier's invoice or payment) keeps its
-- row and its files: "deleted_at" and "deleted_by_id" say when and who, and
-- every read leaves it out. Safe to re-run. Apply it before deploying: Drizzle
-- reads every column of these tables.
--
-- Not only additive: two unique constraints become partial unique indexes
-- under the same names (among the rows not deleted), so a deleted project
-- doesn't keep its ref taken, nor a deleted invoice its number. Each swap is
-- one transaction: the rule is never missing.

BEGIN;

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deleted_by_id" text;
ALTER TABLE "project_documents" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "project_documents" ADD COLUMN IF NOT EXISTS "deleted_by_id" text;
ALTER TABLE "project_photos" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "project_photos" ADD COLUMN IF NOT EXISTS "deleted_by_id" text;
ALTER TABLE "obra_issue_files" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "obra_issue_files" ADD COLUMN IF NOT EXISTS "deleted_by_id" text;
ALTER TABLE "subcontractor_assignments" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "subcontractor_assignments" ADD COLUMN IF NOT EXISTS "deleted_by_id" text;
ALTER TABLE "purchase_order_documents" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "purchase_order_documents" ADD COLUMN IF NOT EXISTS "deleted_by_id" text;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "deleted_by_id" text;
ALTER TABLE "purchase_payments" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "purchase_payments" ADD COLUMN IF NOT EXISTS "deleted_by_id" text;

-- Who deleted it: the foreign keys under the names Drizzle gives them, each added once.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects', 'project_documents', 'project_photos', 'obra_issue_files',
    'subcontractor_assignments', 'purchase_order_documents', 'purchase_invoices', 'purchase_payments'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_deleted_by_id_users_id_fk' AND conrelid = t::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION',
        t, t || '_deleted_by_id_users_id_fk'
      );
    END IF;
  END LOOP;
END $$;

-- A project's ref is unique in its tenant among the projects not deleted.
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_tenant_ref_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "projects_tenant_ref_unique"
  ON "projects" ("tenant_id", "ref") WHERE "deleted_at" IS NULL;

-- A supplier's invoice number is unique among the invoices not deleted.
ALTER TABLE "purchase_invoices" DROP CONSTRAINT IF EXISTS "purchase_invoices_supplier_number_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_invoices_supplier_number_unique"
  ON "purchase_invoices" ("tenant_id", "subcontractor_id", "number") WHERE "deleted_at" IS NULL;

COMMIT;
