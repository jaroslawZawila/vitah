-- The client app's Contacto screen (packages/core/src/contact.ts): a project's site
-- manager (one of the tenant's staff users), a staff user's contact phone, and the
-- office the builder shows its clients (address, phone, email, opening hours).
-- Additive only, every column nullable; safe to run more than once. Apply it before
-- deploying: Drizzle names every column of users, tenants and projects it reads.

-- Never queue the portal behind this file: if a lock is not free in 5 s it fails, whole, and is run again.
SET LOCAL lock_timeout = '5s';

-- Each ALTER holds ACCESS EXCLUSIVE on its table until the file ends, so the tables go in the order the
-- application locks them: a project's write takes the project's row first (lockProject, the claim and
-- request numbering, assigning a client), then reads or points at users and tenants (the keys of what it
-- inserts); none touches users or tenants and then projects. So this order never waits in a cycle with
-- one; the reverse could (a deadlock: one of the two aborted).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS site_manager_user_id text;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS office_address text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS office_phone text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS office_email text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS office_hours text;

-- A pointer that empties when its user goes: single-column, like client_user_id. The
-- column is new and empty, so validating it checks nothing; it is still added NOT VALID
-- and validated on its own, as every key on a table with rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.projects'::regclass AND conname = 'projects_site_manager_user_id_users_id_fk'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_site_manager_user_id_users_id_fk
      FOREIGN KEY (site_manager_user_id) REFERENCES users (id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
ALTER TABLE projects VALIDATE CONSTRAINT projects_site_manager_user_id_users_id_fk;
