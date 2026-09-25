-- Prod migration for project photos. Additive only; safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS "project_photos" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "caption" text,
  "pathname" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "uploaded_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_photos_pathname_unique" UNIQUE ("pathname")
);

CREATE INDEX IF NOT EXISTS "project_photos_project_idx" ON "project_photos" ("project_id");

COMMIT;
