-- A project is never erased: deleting one is a soft delete in the application
-- (deleted_at). Its foreign keys still cascaded, so a hand-run `DELETE FROM projects`
-- would have erased everything under it. Every foreign key that references projects
-- and cascades becomes NO ACTION, under the same name, on the same columns: deleting a
-- project that has anything under it is refused. NO ACTION, not RESTRICT: it is
-- checked at the end of the statement, so deleting a whole tenant (whose cascade
-- removes the project and its rows in the same statement) still works.
--
-- The keys schema.ts knows already stopped cascading in the file before this one
-- (2026-11-15-1010-tenant-composite-keys.sql creates them NO ACTION). This file takes
-- whatever still cascades: found by what they are, not by name, so it covers the keys
-- production has and schema.ts does not (the first version's tables). Each is added back NOT VALID and validated on its own (it can
-- only fail where its rows already broke the key it replaces: a NOTICE names it).
-- Idempotent: once nothing that references projects cascades, it does nothing.

-- Never queue the portal behind this file: if a lock is not free in 5 s it fails, whole, and is run again.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT k.conrelid::regclass AS tbl, k.conname AS name,
      (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord)
         FROM unnest(k.conkey) WITH ORDINALITY u(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum) AS cols,
      (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord)
         FROM unnest(k.confkey) WITH ORDINALITY u(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.attnum) AS ref_cols
    FROM pg_constraint k
    WHERE k.contype = 'f' AND k.confrelid = 'public.projects'::regclass AND k.confdeltype = 'c'
    ORDER BY 1, 2
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', f.tbl, f.name);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES public.projects (%s) ON DELETE NO ACTION NOT VALID',
      f.tbl, f.name, f.cols, f.ref_cols
    );
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', f.tbl, f.name);
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'NOT VALID: % on % (rows point at a project that is not there; see the preflight)', f.name, f.tbl;
    END;
  END LOOP;
END $$;
