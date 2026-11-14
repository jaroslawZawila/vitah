-- Prod migration: the proof of a budget's acceptance (packages/core/src/budget.ts
-- › acceptRevision). The revision that becomes the contract now keeps the staff
-- user who registered it and the client's signed copy among the project's
-- documents. Revisions accepted before this keep both null: the portal then
-- shows neither. Additive only; safe to re-run. Apply it before deploying:
-- Drizzle reads every column of budget_revisions.

ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "accepted_by_user_id" text;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "accepted_document_id" text;

-- The foreign keys under the names Drizzle gives them, each added once.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'budget_revisions_accepted_by_user_id_users_id_fk'
      AND conrelid = 'budget_revisions'::regclass
  ) THEN
    ALTER TABLE "budget_revisions"
      ADD CONSTRAINT "budget_revisions_accepted_by_user_id_users_id_fk"
      FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'budget_revisions_accepted_document_id_project_documents_id_fk'
      AND conrelid = 'budget_revisions'::regclass
  ) THEN
    ALTER TABLE "budget_revisions"
      ADD CONSTRAINT "budget_revisions_accepted_document_id_project_documents_id_fk"
      FOREIGN KEY ("accepted_document_id") REFERENCES "project_documents"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
