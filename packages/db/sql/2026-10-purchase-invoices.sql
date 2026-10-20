-- Prod migration: supplier invoices and payments (Compras). Additive only;
-- safe to re-run. An order's invoicing terms and payment milestones; the
-- suppliers' invoices and credit notes, split across budget lines, with their
-- PDF versions; and the payments made against them.

ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "payment_days" integer;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "retention_bp" integer DEFAULT 0 NOT NULL;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "vat_kind" text;

CREATE TABLE IF NOT EXISTS "purchase_order_milestones" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "order_id" text NOT NULL REFERENCES "purchase_orders"("id") ON DELETE cascade,
  "position" integer NOT NULL,
  "concept" text NOT NULL,
  "amount_cents" integer NOT NULL
);
CREATE INDEX IF NOT EXISTS "purchase_order_milestones_order_idx" ON "purchase_order_milestones" ("order_id");

CREATE TABLE IF NOT EXISTS "purchase_invoices" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "order_id" text NOT NULL REFERENCES "purchase_orders"("id") ON DELETE cascade,
  "subcontractor_id" text NOT NULL REFERENCES "subcontractors"("id"),
  "kind" text DEFAULT 'invoice' NOT NULL,
  "number" text NOT NULL,
  "milestone_id" text REFERENCES "purchase_order_milestones"("id"),
  "rectifies_id" text REFERENCES "purchase_invoices"("id"),
  "issued_on" date NOT NULL,
  "due_on" date,
  "base_cents" integer NOT NULL,
  "vat_kind" text NOT NULL,
  "vat_cents" integer NOT NULL,
  "irpf_bp" integer DEFAULT 0 NOT NULL,
  "irpf_cents" integer DEFAULT 0 NOT NULL,
  "retention_bp" integer DEFAULT 0 NOT NULL,
  "retention_cents" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_invoices_supplier_number_unique" UNIQUE ("tenant_id", "subcontractor_id", "number")
);
CREATE INDEX IF NOT EXISTS "purchase_invoices_order_idx" ON "purchase_invoices" ("order_id");
CREATE INDEX IF NOT EXISTS "purchase_invoices_tenant_due_idx" ON "purchase_invoices" ("tenant_id", "due_on");
CREATE INDEX IF NOT EXISTS "purchase_invoices_rectifies_idx" ON "purchase_invoices" ("rectifies_id");

CREATE TABLE IF NOT EXISTS "purchase_invoice_lines" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "invoice_id" text NOT NULL REFERENCES "purchase_invoices"("id") ON DELETE cascade,
  "lineage_id" text NOT NULL,
  "chapter_code" text NOT NULL,
  "amount_cents" integer NOT NULL,
  CONSTRAINT "purchase_invoice_lines_invoice_lineage_unique" UNIQUE ("invoice_id", "lineage_id")
);

CREATE TABLE IF NOT EXISTS "purchase_invoice_files" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "invoice_id" text NOT NULL REFERENCES "purchase_invoices"("id") ON DELETE cascade,
  "version" integer NOT NULL,
  "pathname" text NOT NULL,
  "filename" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "note" text,
  "uploaded_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_invoice_files_pathname_unique" UNIQUE ("pathname"),
  CONSTRAINT "purchase_invoice_files_invoice_version_unique" UNIQUE ("invoice_id", "version")
);

CREATE TABLE IF NOT EXISTS "purchase_payments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "invoice_id" text NOT NULL REFERENCES "purchase_invoices"("id") ON DELETE cascade,
  "paid_on" date NOT NULL,
  "amount_cents" integer NOT NULL,
  "method" text NOT NULL,
  "reference" text,
  "file_name" text,
  "file_pathname" text,
  "file_size_bytes" integer,
  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "purchase_payments_invoice_idx" ON "purchase_payments" ("invoice_id");
CREATE INDEX IF NOT EXISTS "purchase_payments_tenant_paid_idx" ON "purchase_payments" ("tenant_id", "paid_on");
