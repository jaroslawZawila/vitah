-- Prod migration: the AI's review of purchase PDFs (warnings only).
-- Additive only; safe to re-run.

CREATE TABLE IF NOT EXISTS "purchase_document_checks" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "order_id" text NOT NULL REFERENCES "purchase_orders"("id") ON DELETE cascade,
  "document_version_id" text REFERENCES "purchase_order_document_versions"("id") ON DELETE cascade,
  "invoice_file_id" text REFERENCES "purchase_invoice_files"("id") ON DELETE cascade,
  "payment_id" text REFERENCES "purchase_payments"("id") ON DELETE cascade,
  "pathname" text NOT NULL,
  "label" text NOT NULL,
  "sha256" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reason" text,
  "started_at" timestamp,
  "checked_at" timestamp,
  "dismissed_at" timestamp,
  "dismissed_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_document_checks_version_unique" UNIQUE ("document_version_id"),
  CONSTRAINT "purchase_document_checks_invoice_file_unique" UNIQUE ("invoice_file_id"),
  CONSTRAINT "purchase_document_checks_payment_unique" UNIQUE ("payment_id")
);
CREATE INDEX IF NOT EXISTS "purchase_document_checks_tenant_status_idx" ON "purchase_document_checks" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "purchase_document_checks_tenant_sha_idx" ON "purchase_document_checks" ("tenant_id", "sha256");
CREATE INDEX IF NOT EXISTS "purchase_document_checks_order_idx" ON "purchase_document_checks" ("order_id");
-- What the review's queue looks for: each tenant's purchase files of the last day.
CREATE INDEX IF NOT EXISTS "purchase_order_document_versions_tenant_created_idx" ON "purchase_order_document_versions" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "purchase_invoice_files_tenant_created_idx" ON "purchase_invoice_files" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "purchase_payments_tenant_created_idx" ON "purchase_payments" ("tenant_id", "created_at");
