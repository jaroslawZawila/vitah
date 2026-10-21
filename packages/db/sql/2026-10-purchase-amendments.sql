-- Prod migration: an order's formal modifications (Compras › modificados).
-- Additive only; safe to re-run.

CREATE TABLE IF NOT EXISTS "purchase_order_amendments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "order_id" text NOT NULL REFERENCES "purchase_orders"("id") ON DELETE cascade,
  "number" integer NOT NULL,
  "concept" text NOT NULL,
  "signed_on" date NOT NULL,
  "amount_before_cents" integer NOT NULL,
  "amount_after_cents" integer NOT NULL,
  "changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "document_id" text REFERENCES "purchase_order_documents"("id") ON DELETE set null,
  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_order_amendments_order_number_unique" UNIQUE ("order_id", "number")
);
