-- Prod migration: the portal's language as a staff setting (es | en; null
-- follows the browser, as before). Additive only; safe to re-run. Apply it
-- before deploying: Drizzle inserts into users name every column.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "language" text;
