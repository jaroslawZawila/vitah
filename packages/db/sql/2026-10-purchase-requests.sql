-- Prod migration: purchase requests (Compras › Solicitudes). Additive only;
-- safe to re-run. What an obra asks to buy before there is an order, its
-- budget lines with an estimate, and its history; approved by an admin, an
-- approved one becomes an order.

CREATE TABLE IF NOT EXISTS "purchase_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "number" integer NOT NULL,
  "kind" text NOT NULL,
  "description" text NOT NULL,
  "needed_by" date,
  "subcontractor_id" text REFERENCES "subcontractors"("id") ON DELETE set null,
  "notes" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "decided_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "decided_at" timestamp,
  "decision_note" text,
  "order_id" text REFERENCES "purchase_orders"("id") ON DELETE set null,
  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_requests_project_number_unique" UNIQUE ("project_id", "number")
);
CREATE INDEX IF NOT EXISTS "purchase_requests_tenant_status_idx" ON "purchase_requests" ("tenant_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_requests_order_unique" ON "purchase_requests" ("order_id") WHERE "order_id" is not null;

CREATE TABLE IF NOT EXISTS "purchase_request_lines" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "request_id" text NOT NULL REFERENCES "purchase_requests"("id") ON DELETE cascade,
  "lineage_id" text NOT NULL,
  "chapter_code" text NOT NULL,
  "amount_cents" integer NOT NULL,
  CONSTRAINT "purchase_request_lines_request_lineage_unique" UNIQUE ("request_id", "lineage_id")
);

CREATE TABLE IF NOT EXISTS "purchase_request_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "request_id" text NOT NULL REFERENCES "purchase_requests"("id") ON DELETE cascade,
  "action" text NOT NULL,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "note" text,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "purchase_request_events_request_created_idx" ON "purchase_request_events" ("request_id", "created_at");
