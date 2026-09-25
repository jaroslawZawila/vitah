-- Prod migration for project documents.
--
-- Prod still had the pre-"start over" `project_documents` table and
-- `document_category` enum (empty; nothing referenced them). They are
-- dropped first, but only while the legacy `file_url` column is there, so
-- re-running this can never drop the new table.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_documents' AND column_name = 'file_url'
  ) THEN
    DROP TABLE "project_documents";
    DROP TYPE "document_category";
  END IF;
END $$;

CREATE TYPE "document_category" AS ENUM ('contract', 'plans', 'certificates', 'other');

CREATE TABLE "project_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "category" "document_category" NOT NULL,
  "pathname" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "uploaded_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_documents_pathname_unique" UNIQUE ("pathname")
);

CREATE INDEX "project_documents_project_idx" ON "project_documents" ("project_id");

COMMIT;
