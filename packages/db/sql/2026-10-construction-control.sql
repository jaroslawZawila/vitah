-- Prod migration: construction control (the project's Obra tab). Additive only;
-- safe to re-run. Actual chapter dates and their history, invoice requests from
-- hitos, the issues and changes log with its files, a photo's day, and which
-- accepted revision's chapter changes staff have reviewed.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "obra_reviewed_revision_id" text;
ALTER TABLE "project_photos" ADD COLUMN IF NOT EXISTS "taken_on" date;

CREATE TABLE IF NOT EXISTS "obra_chapter_progress" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "chapter_code" text NOT NULL,
  "actual_start" date,
  "actual_end" date,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "obra_chapter_progress_project_chapter_unique" UNIQUE ("project_id", "chapter_code")
);

CREATE TABLE IF NOT EXISTS "obra_progress_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "chapter_code" text NOT NULL,
  "kind" text NOT NULL,
  "previous_date" date,
  "new_date" date,
  "note" text,
  "recorded_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "recorded_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "obra_progress_events_project_idx" ON "obra_progress_events" ("project_id", "recorded_at");

CREATE TABLE IF NOT EXISTS "obra_invoice_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "hito_id" text NOT NULL REFERENCES "obra_hitos"("id") ON DELETE cascade,
  "chapter_code" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "description" text NOT NULL,
  "client_name" text,
  "requested_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "requested_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "obra_invoice_requests_hito_unique" UNIQUE ("hito_id")
);

CREATE TABLE IF NOT EXISTS "obra_issues" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "number" integer NOT NULL,
  "occurred_on" date NOT NULL,
  "chapter_code" text NOT NULL,
  "description" text NOT NULL,
  "party" text NOT NULL,
  "party_name" text,
  "cost_impact_cents" integer,
  "schedule_impact_days" integer,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "obra_issues_project_kind_number_unique" UNIQUE ("project_id", "kind", "number")
);

CREATE TABLE IF NOT EXISTS "obra_issue_files" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "issue_id" text NOT NULL REFERENCES "obra_issues"("id") ON DELETE cascade,
  "filename" text NOT NULL,
  "pathname" text NOT NULL UNIQUE,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "uploaded_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "obra_issue_files_issue_idx" ON "obra_issue_files" ("issue_id");
