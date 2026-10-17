-- Prod migration: purchasing (Compras). Additive only; safe to re-run. A
-- project's orders of material and subcontracts, split across budget lines,
-- with their history; and material suppliers in the Subcontratas list.

ALTER TABLE "subcontractors" ADD COLUMN IF NOT EXISTS "supplies_only" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "number" integer NOT NULL,
  "kind" text NOT NULL,
  "subcontractor_id" text NOT NULL REFERENCES "subcontractors"("id"),
  "description" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "ordered_on" date,
  "expected_on" date,
  "work_start" date,
  "work_end" date,
  "completed_on" date,
  "notes" text,
  "file_name" text,
  "file_pathname" text,
  "file_size_bytes" integer,
  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_orders_project_number_unique" UNIQUE ("project_id", "number")
);
CREATE INDEX IF NOT EXISTS "purchase_orders_tenant_idx" ON "purchase_orders" ("tenant_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_subcontractor_idx" ON "purchase_orders" ("subcontractor_id");

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "order_id" text NOT NULL REFERENCES "purchase_orders"("id") ON DELETE cascade,
  "lineage_id" text NOT NULL,
  "chapter_code" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "closes_line" boolean DEFAULT true NOT NULL,
  CONSTRAINT "purchase_order_lines_order_lineage_unique" UNIQUE ("order_id", "lineage_id")
);

CREATE TABLE IF NOT EXISTS "purchase_order_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "order_id" text NOT NULL REFERENCES "purchase_orders"("id") ON DELETE cascade,
  "action" text NOT NULL,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "note" text,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "purchase_order_events_order_created_idx" ON "purchase_order_events" ("order_id", "created_at");
