-- Prod migration: the budget in the FRAMER model (features/budget/TECH_DESIGN.md §3).
-- Additive only; safe to re-run. ALTER TYPE … ADD VALUE can't run inside a
-- transaction block on older Postgres: run this file without BEGIN/COMMIT.

-- Revisions: issued to the client (frozen, with its PDFs) and rejected.
ALTER TYPE "budget_revision_status" ADD VALUE IF NOT EXISTS 'issued';
ALTER TYPE "budget_revision_status" ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE "document_category" ADD VALUE IF NOT EXISTS 'budget';

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "ai_monthly_limit_cents" integer;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "letterhead" jsonb;

ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "model" text;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "contingency_bp" integer DEFAULT 500 NOT NULL;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "quality" text;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "texts" jsonb;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "conditions" jsonb;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "review" jsonb;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "change_reason" text;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "issued_on" date;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "valid_until" date;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "accepted_on" date;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "accepted_by" text;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "rejected_on" date;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "generation_id" text;

-- Chapters and options share a table: options are priced apart, below the PEC.
ALTER TABLE "budget_chapters" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'chapter' NOT NULL;
ALTER TABLE "budget_chapters" ADD COLUMN IF NOT EXISTS "pdf_note" text;
ALTER TABLE "budget_chapters" ADD COLUMN IF NOT EXISTS "option_kind" text;
ALTER TABLE "budget_chapters" ADD COLUMN IF NOT EXISTS "replaces_line" text;
ALTER TABLE "budget_chapters" ADD COLUMN IF NOT EXISTS "chosen" boolean;

ALTER TABLE "budget_lines" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual' NOT NULL;
ALTER TABLE "budget_lines" ADD COLUMN IF NOT EXISTS "base_code" text;
ALTER TABLE "budget_lines" ADD COLUMN IF NOT EXISTS "note" text;
ALTER TABLE "budget_lines" ADD COLUMN IF NOT EXISTS "lineage_id" text DEFAULT gen_random_uuid()::text NOT NULL;
-- Existing revisions were copies of each other: a line keeps its lineage
-- across a project's revisions by chapter and line code (run once).
UPDATE "budget_lines" AS l SET "lineage_id" = first.lineage
FROM (
  SELECT bl.id, first_value(bl.lineage_id) OVER (PARTITION BY r.project_id, c.kind, c.code, bl.code ORDER BY r.number) AS lineage
  FROM "budget_lines" bl
  JOIN "budget_chapters" c ON c.id = bl.chapter_id
  JOIN "budget_revisions" r ON r.id = c.revision_id
) AS first
WHERE l.id = first.id AND l.lineage_id <> first.lineage;

-- Documents: who sees them, and the budget's inputs and PDFs.
ALTER TABLE "project_documents" ADD COLUMN IF NOT EXISTS "visible_to_client" boolean DEFAULT true NOT NULL;
ALTER TABLE "project_documents" ADD COLUMN IF NOT EXISTS "content_type" text DEFAULT 'application/pdf' NOT NULL;
ALTER TABLE "project_documents" ADD COLUMN IF NOT EXISTS "filename" text;
ALTER TABLE "project_documents" ADD COLUMN IF NOT EXISTS "budget_input" text;
ALTER TABLE "project_documents" ADD COLUMN IF NOT EXISTS "budget_revision_id" text
  REFERENCES "budget_revisions"("id") ON DELETE SET NULL;
ALTER TABLE "project_documents" ADD COLUMN IF NOT EXISTS "budget_pdf" text;
ALTER TABLE "project_documents" ADD COLUMN IF NOT EXISTS "claude_file_id" text;

CREATE TABLE IF NOT EXISTS "budget_generations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "step" integer DEFAULT 0 NOT NULL,
  "log" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "options" jsonb NOT NULL,
  "document_ids" text[] NOT NULL,
  "extracted" jsonb,
  "state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "revision_id" text REFERENCES "budget_revisions"("id") ON DELETE SET NULL,
  "workflow_run_id" text,
  "error" text,
  "created_by_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "budget_generations_project_idx" ON "budget_generations" ("project_id");

CREATE TABLE IF NOT EXISTS "ai_usage" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "project_id" text REFERENCES "projects"("id") ON DELETE SET NULL,
  "generation_id" text REFERENCES "budget_generations"("id") ON DELETE SET NULL,
  "purpose" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer NOT NULL,
  "output_tokens" integer NOT NULL,
  "cache_read_tokens" integer DEFAULT 0 NOT NULL,
  "cache_write_tokens" integer DEFAULT 0 NOT NULL,
  "cost_micro_usd" bigint NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ai_usage_tenant_created_idx" ON "ai_usage" ("tenant_id", "created_at");
