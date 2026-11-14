-- Prod migration: the history of a hito's collection from the client. Additive
-- only; safe to re-run. One row per acta or invoice uploaded, replaced or
-- removed and per payment registered, corrected or cancelled, with what was
-- there before and who did it. Append-only: nothing updates or deletes its rows
-- (a replaced or removed PDF stays in the Blob store, its pathname in "detail").

CREATE TABLE IF NOT EXISTS "obra_hito_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "hito_id" text NOT NULL REFERENCES "obra_hitos"("id") ON DELETE cascade,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "action" text NOT NULL,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "obra_hito_events_hito_idx" ON "obra_hito_events" ("hito_id");
CREATE INDEX IF NOT EXISTS "obra_hito_events_tenant_idx" ON "obra_hito_events" ("tenant_id");
