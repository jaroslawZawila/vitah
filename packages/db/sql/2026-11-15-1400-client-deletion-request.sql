-- A client's request, from the app's Perfil, for their account to be deleted:
-- when they asked (null: never, or withdrawn). Only a request: the builder
-- handles it by hand on Clientes; nothing reads it to delete or deactivate.
-- Clients only (users_deletion_request_check).
--
-- Additive; safe to re-run. Apply it BEFORE deploying the code that uses it:
-- Drizzle names every column of users when it inserts one. The previous
-- deployment never reads the column, and every row starts null, so the check
-- holds for all of them.

-- Never queue the portal behind this file: if a lock is not free in 5 s it fails, whole, and is run again.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deletion_requested_at" timestamp;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND conname = 'users_deletion_request_check'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_deletion_request_check"
      CHECK ("deletion_requested_at" IS NULL OR "role" = 'client') NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE "users" VALIDATE CONSTRAINT "users_deletion_request_check";
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'NOT VALID: users_deletion_request_check on users (a staff row has deletion_requested_at)';
  END;
END $$;
