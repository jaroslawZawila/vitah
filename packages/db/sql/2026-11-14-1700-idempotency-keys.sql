-- Idempotency keys: a create its caller may send twice (a double click, a
-- retry after a timeout) is applied once. One row per tenant, operation
-- ("scope") and caller's key, with the hash of the request and what the first
-- call answered; written in the create's own transaction
-- (packages/core/src/idempotency.ts). Additive: a new table, read only by the
-- new code; the previous deployment never touches it. Safe to run twice.

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "scope" text NOT NULL,
  "key" text NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "request_hash" text NOT NULL,
  "result" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "idempotency_keys_pk" PRIMARY KEY ("tenant_id", "scope", "key")
);
CREATE INDEX IF NOT EXISTS "idempotency_keys_created_idx" ON "idempotency_keys" ("created_at");
