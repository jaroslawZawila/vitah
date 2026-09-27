-- Obra: budget (revisions → chapters → lines), payment hitos H0–H9 and the
-- project's process stage. See features/construction_process/PROCESS.md.
--
-- Also removes what the reverted obra slice (commits ab6047b and 4389e03,
-- files 2026-09-obra.sql / 2026-09-obra-2.sql) left in prod. The app never
-- shipped with it, so those tables hold no data anyone needs.

BEGIN;

-- ─── Leftovers of the reverted slice ───────────────────────────────────────
DROP TABLE IF EXISTS "budget_line_subtasks" CASCADE;
DROP TABLE IF EXISTS "budget_progress_entries" CASCADE;
DROP TABLE IF EXISTS "budget_expenses" CASCADE;
DROP TABLE IF EXISTS "daily_log_companies" CASCADE;
DROP TABLE IF EXISTS "obra_subtasks" CASCADE;
DROP TABLE IF EXISTS "obra_phases" CASCADE;
DROP TABLE IF EXISTS "budget_lines" CASCADE;
DROP TABLE IF EXISTS "budget_chapters" CASCADE;
DROP TABLE IF EXISTS "obras" CASCADE;
ALTER TABLE "project_photos" DROP COLUMN IF EXISTS "daily_log_id";
ALTER TABLE "project_photos" DROP COLUMN IF EXISTS "before_cover";
ALTER TABLE "project_photos" DROP COLUMN IF EXISTS "client_visible";
DROP TABLE IF EXISTS "daily_logs" CASCADE;
DROP TYPE IF EXISTS "obra_subtask_status";

-- ─── Project stage and photo chapter ───────────────────────────────────────
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "obra_stage" integer DEFAULT 1 NOT NULL;
ALTER TABLE "project_photos" ADD COLUMN IF NOT EXISTS "chapter_code" text;

-- ─── Budget ────────────────────────────────────────────────────────────────
CREATE TYPE "budget_revision_status" AS ENUM ('draft', 'accepted', 'superseded');

CREATE TABLE "budget_revisions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL CONSTRAINT "budget_revisions_tenant_id_tenants_id_fk" REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL CONSTRAINT "budget_revisions_project_id_projects_id_fk" REFERENCES "projects"("id") ON DELETE cascade,
  "number" integer NOT NULL,
  "status" "budget_revision_status" DEFAULT 'draft' NOT NULL,
  "reference" text,
  "vat_rate_bp" integer DEFAULT 1000 NOT NULL,
  "built_area_cm2" integer,
  "useful_area_cm2" integer,
  "exclusions" text,
  "accepted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "budget_revisions_project_number_unique" UNIQUE("project_id", "number")
);

CREATE TABLE "budget_chapters" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL CONSTRAINT "budget_chapters_tenant_id_tenants_id_fk" REFERENCES "tenants"("id") ON DELETE cascade,
  "revision_id" text NOT NULL CONSTRAINT "budget_chapters_revision_id_budget_revisions_id_fk" REFERENCES "budget_revisions"("id") ON DELETE cascade,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "position" integer NOT NULL,
  "change_note" text,
  CONSTRAINT "budget_chapters_revision_code_unique" UNIQUE("revision_id", "code")
);

CREATE TABLE "budget_lines" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL CONSTRAINT "budget_lines_tenant_id_tenants_id_fk" REFERENCES "tenants"("id") ON DELETE cascade,
  "chapter_id" text NOT NULL CONSTRAINT "budget_lines_chapter_id_budget_chapters_id_fk" REFERENCES "budget_chapters"("id") ON DELETE cascade,
  "code" text NOT NULL,
  "description" text NOT NULL,
  "unit" text NOT NULL,
  "quantity_milli" integer NOT NULL,
  "unit_price_cents" integer NOT NULL,
  "executed_pct" integer DEFAULT 0 NOT NULL,
  "position" integer NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "budget_lines_chapter_idx" ON "budget_lines" ("chapter_id");

-- ─── Payment hitos ─────────────────────────────────────────────────────────
CREATE TABLE "obra_hitos" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL CONSTRAINT "obra_hitos_tenant_id_tenants_id_fk" REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL CONSTRAINT "obra_hitos_project_id_projects_id_fk" REFERENCES "projects"("id") ON DELETE cascade,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "pct_bp" integer NOT NULL,
  "scope" text NOT NULL,
  "billing_moment" text NOT NULL,
  "position" integer NOT NULL,
  "acta_signed_on" date,
  "acta_pathname" text,
  "acta_size_bytes" integer,
  "invoiced_on" date,
  "invoice_pathname" text,
  "invoice_size_bytes" integer,
  "paid_on" date,
  "paid_amount_cents" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "obra_hitos_project_code_unique" UNIQUE("project_id", "code")
);

CREATE TABLE "obra_hito_chapters" (
  "hito_id" text NOT NULL CONSTRAINT "obra_hito_chapters_hito_id_obra_hitos_id_fk" REFERENCES "obra_hitos"("id") ON DELETE cascade,
  "tenant_id" text NOT NULL CONSTRAINT "obra_hito_chapters_tenant_id_tenants_id_fk" REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL CONSTRAINT "obra_hito_chapters_project_id_projects_id_fk" REFERENCES "projects"("id") ON DELETE cascade,
  "chapter_code" text NOT NULL,
  CONSTRAINT "obra_hito_chapters_hito_id_chapter_code_pk" PRIMARY KEY("hito_id", "chapter_code"),
  CONSTRAINT "obra_hito_chapters_project_chapter_unique" UNIQUE("project_id", "chapter_code")
);

CREATE TABLE "obra_hito_checks" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL CONSTRAINT "obra_hito_checks_tenant_id_tenants_id_fk" REFERENCES "tenants"("id") ON DELETE cascade,
  "hito_id" text NOT NULL CONSTRAINT "obra_hito_checks_hito_id_obra_hitos_id_fk" REFERENCES "obra_hitos"("id") ON DELETE cascade,
  "label" text NOT NULL,
  "done" boolean DEFAULT false NOT NULL,
  "position" integer NOT NULL
);
CREATE INDEX "obra_hito_checks_hito_idx" ON "obra_hito_checks" ("hito_id");

CREATE TABLE "obra_hito_photos" (
  "hito_id" text NOT NULL CONSTRAINT "obra_hito_photos_hito_id_obra_hitos_id_fk" REFERENCES "obra_hitos"("id") ON DELETE cascade,
  "photo_id" text NOT NULL CONSTRAINT "obra_hito_photos_photo_id_project_photos_id_fk" REFERENCES "project_photos"("id") ON DELETE cascade,
  "tenant_id" text NOT NULL CONSTRAINT "obra_hito_photos_tenant_id_tenants_id_fk" REFERENCES "tenants"("id") ON DELETE cascade,
  CONSTRAINT "obra_hito_photos_hito_id_photo_id_pk" PRIMARY KEY("hito_id", "photo_id")
);

COMMIT;
