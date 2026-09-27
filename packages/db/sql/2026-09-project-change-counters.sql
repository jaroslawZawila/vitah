-- Prod migration: change counters the client's open app polls
-- (GET /api/mobile/changes). Additive only; safe to re-run. Existing projects
-- start at 0, which the app takes as its first reading.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "project_rev" integer DEFAULT 0 NOT NULL;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "obra_rev" integer DEFAULT 0 NOT NULL;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "photos_rev" integer DEFAULT 0 NOT NULL;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "documents_rev" integer DEFAULT 0 NOT NULL;
