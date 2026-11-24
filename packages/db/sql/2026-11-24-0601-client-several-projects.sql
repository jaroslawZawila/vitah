-- A mobile-app client may now be the homeowner of several projects: the app
-- shows one at a time and opens on the newest one not yet handed over
-- (packages/core/src/client-projects.ts). Drops the one-project-per-client
-- rule and keeps an index for looking up a client's projects.
-- Additive and safe to run more than once.

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_client_user_unique;
-- In case it was made as a plain unique index instead.
DROP INDEX IF EXISTS projects_client_user_unique;
CREATE INDEX IF NOT EXISTS projects_client_user_idx ON projects (client_user_id);
