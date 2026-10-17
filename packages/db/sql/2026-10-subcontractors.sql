-- Prod migration: the Subcontratas module (companies, workers, their CAE
-- documents and versions, obra assignments and the audit log). Additive only;
-- safe to re-run.
BEGIN;

DO $$ BEGIN
  CREATE TYPE "subcontractor_kind" AS ENUM ('company', 'self_employed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "prevention_mode" AS ENUM ('external_service', 'own_service', 'joint_service', 'employer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "subcontractor_doc_status" AS ENUM ('requested', 'uploaded', 'validated', 'rejected', 'not_applicable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "subcontractors" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "kind" "subcontractor_kind" NOT NULL,
  "legal_name" text NOT NULL,
  "tax_id" text NOT NULL,
  "address" text NOT NULL,
  "postal_code" text NOT NULL,
  "city" text NOT NULL,
  "province" text NOT NULL,
  "rea_region" text NOT NULL,
  "rea_number" text,
  "phone" text,
  "email" text,
  "legal_rep" text,
  "site_contact" text,
  "site_contact_phone" text,
  "trades" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_installer" boolean DEFAULT false NOT NULL,
  "installer_reg" text,
  "headcount" integer,
  "permanent_count" integer,
  "subcontracts_further" boolean DEFAULT false NOT NULL,
  "chain_level" integer DEFAULT 1 NOT NULL,
  "prevention_mode" "prevention_mode",
  "prevention_entity" text,
  "prevention_valid_until" date,
  "machinery" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "subcontractors_tenant_tax_id_unique" UNIQUE ("tenant_id", "tax_id")
);

CREATE TABLE IF NOT EXISTS "subcontractor_workers" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "subcontractor_id" text NOT NULL REFERENCES "subcontractors"("id") ON DELETE cascade,
  "first_name" text NOT NULL,
  "surnames" text NOT NULL,
  "id_document" text NOT NULL,
  "phone" text,
  "category" text,
  "trade" text,
  "ss_number" text,
  "contract_type" text,
  "start_date" date,
  "tpc_number" text,
  "roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "ppe_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "subcontractor_workers_tenant_id_document_unique" UNIQUE ("tenant_id", "id_document")
);
CREATE INDEX IF NOT EXISTS "subcontractor_workers_subcontractor_idx" ON "subcontractor_workers" ("subcontractor_id");
CREATE INDEX IF NOT EXISTS "subcontractor_workers_tenant_tpc_idx" ON "subcontractor_workers" ("tenant_id", "tpc_number");

CREATE TABLE IF NOT EXISTS "subcontractor_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "subcontractor_id" text NOT NULL REFERENCES "subcontractors"("id") ON DELETE cascade,
  "worker_id" text REFERENCES "subcontractor_workers"("id") ON DELETE cascade,
  "project_id" text REFERENCES "projects"("id") ON DELETE cascade,
  "requirement_id" text NOT NULL,
  "status" "subcontractor_doc_status" NOT NULL,
  "not_applicable_reason" text,
  "requested_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "subcontractor_documents_owner_requirement_unique"
    UNIQUE NULLS NOT DISTINCT ("subcontractor_id", "worker_id", "project_id", "requirement_id")
);
CREATE INDEX IF NOT EXISTS "subcontractor_documents_tenant_idx" ON "subcontractor_documents" ("tenant_id");

CREATE TABLE IF NOT EXISTS "subcontractor_document_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "document_id" text NOT NULL REFERENCES "subcontractor_documents"("id") ON DELETE cascade,
  "version" integer NOT NULL,
  "pathname" text NOT NULL,
  "filename" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "issued_at" date,
  "expires_at" date,
  "uploaded_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "reviewed_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "reviewed_at" timestamp,
  "reject_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "subcontractor_document_versions_pathname_unique" UNIQUE ("pathname"),
  CONSTRAINT "subcontractor_document_versions_document_version_unique" UNIQUE ("document_id", "version")
);
CREATE INDEX IF NOT EXISTS "subcontractor_document_versions_tenant_document_idx" ON "subcontractor_document_versions" ("tenant_id", "document_id", "version");

CREATE TABLE IF NOT EXISTS "subcontractor_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "subcontractor_id" text NOT NULL REFERENCES "subcontractors"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "chapter_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "planned_start" date,
  "planned_end" date,
  "book_order" integer,
  "book_date" date,
  "css_informed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "subcontractor_assignments_subcontractor_project_unique" UNIQUE ("subcontractor_id", "project_id")
);
CREATE INDEX IF NOT EXISTS "subcontractor_assignments_tenant_idx" ON "subcontractor_assignments" ("tenant_id");

CREATE TABLE IF NOT EXISTS "subcontractor_audit" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "subcontractor_id" text NOT NULL REFERENCES "subcontractors"("id") ON DELETE cascade,
  "worker_id" text REFERENCES "subcontractor_workers"("id") ON DELETE set null,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "action" text NOT NULL,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "subcontractor_audit_subcontractor_created_idx" ON "subcontractor_audit" ("subcontractor_id", "created_at");

COMMIT;
