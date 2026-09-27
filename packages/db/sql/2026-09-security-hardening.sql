-- Prod migration: security hardening. Additive only; safe to re-run.

-- Mobile tokens issued before a password change or reset are revoked.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp;

-- Failed sign-ins per email / IP, for login throttling.
CREATE TABLE IF NOT EXISTS "login_attempts" (
  "key" text PRIMARY KEY NOT NULL,
  "failures" integer DEFAULT 0 NOT NULL,
  "window_start" timestamp DEFAULT now() NOT NULL
);

-- The portal login looks staff up by email alone, so a staff email must be
-- unique across tenants (case-insensitive). Before running, check there are
-- no duplicates; this must return no rows:
--   SELECT lower(email), count(*) FROM users WHERE role <> 'client'
--   GROUP BY lower(email) HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "users_staff_email_unique"
  ON "users" (lower("email")) WHERE "role" <> 'client';
