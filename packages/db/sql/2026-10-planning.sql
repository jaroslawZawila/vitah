-- Prod migration: Planning (the works schedule on the Obra tab). Additive only;
-- safe to re-run. Versions of a project's schedule (one draft and one approved
-- baseline at most) and, per version, each contract chapter's dependency,
-- duration in working days and the dates that gives.

CREATE TABLE IF NOT EXISTS "planning_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "number" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "start_date" date NOT NULL,
  "region" text,
  "august_closure" boolean DEFAULT true NOT NULL,
  "christmas_closure" boolean DEFAULT true NOT NULL,
  "reason" text,
  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "approved_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "approved_at" timestamp,
  CONSTRAINT "planning_versions_project_number_unique" UNIQUE ("project_id", "number")
);
CREATE UNIQUE INDEX IF NOT EXISTS "planning_versions_one_draft" ON "planning_versions" ("project_id") WHERE "status" = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS "planning_versions_one_approved" ON "planning_versions" ("project_id") WHERE "status" = 'approved';

CREATE TABLE IF NOT EXISTS "planning_items" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "version_id" text NOT NULL REFERENCES "planning_versions"("id") ON DELETE cascade,
  "chapter_code" text NOT NULL,
  "position" integer NOT NULL,
  "after_code" text,
  "lag_days" integer DEFAULT 0 NOT NULL,
  "duration_days" integer NOT NULL,
  "fixed_start" date,
  "spans_works" boolean DEFAULT false NOT NULL,
  "planned_start" date NOT NULL,
  "planned_end" date NOT NULL,
  CONSTRAINT "planning_items_version_chapter_unique" UNIQUE ("version_id", "chapter_code")
);
