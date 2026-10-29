-- Prod migration: staff can hide a site photo from the client's app, as they
-- can a document, and the client is pushed about a photo or document once
-- only, however often it is hidden and shown again. Additive only; safe to
-- re-run. Apply it before deploying: Drizzle inserts name every column.
-- What the client already sees counts as told, so showing it again later
-- pushes nothing.

ALTER TABLE "project_photos" ADD COLUMN IF NOT EXISTS "visible_to_client" boolean DEFAULT true NOT NULL;
ALTER TABLE "project_photos" ADD COLUMN IF NOT EXISTS "client_notified_at" timestamp;
ALTER TABLE "project_documents" ADD COLUMN IF NOT EXISTS "client_notified_at" timestamp;

UPDATE "project_photos" SET "client_notified_at" = "created_at"
WHERE "client_notified_at" IS NULL AND "visible_to_client";
UPDATE "project_documents" SET "client_notified_at" = "created_at"
WHERE "client_notified_at" IS NULL AND "visible_to_client";
