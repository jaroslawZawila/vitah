-- Prod migration: client app settings (Perfil tab) and push tokens.
-- Additive only; safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS "client_settings" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "notify_progress" boolean DEFAULT true NOT NULL,
  "notify_documents" boolean DEFAULT true NOT NULL,
  "notify_messages" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "push_tokens" (
  "token" text PRIMARY KEY NOT NULL,
  "language" text DEFAULT 'es' NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "push_tokens_user_idx" ON "push_tokens" ("user_id");

COMMIT;
