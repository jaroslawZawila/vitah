-- Gastos asociados go from 13 % to 16 % of the cost (DEFAULT_MARGINS, 35eee94).
-- Moves the drafts still at the old default; issued, accepted, rejected and
-- superseded revisions are frozen and keep theirs. A draft at 0 % (priced before
-- the margins) or at a % staff typed by hand is left alone. Drafts are never
-- shown to the client, so no change counter moves. Safe to run twice.

-- Preview:
-- SELECT p.ref, r.number, r.overhead_bp, r.profit_bp
--   FROM budget_revisions r JOIN projects p ON p.id = r.project_id
--  WHERE r.status = 'draft' AND r.overhead_bp = 1300;

UPDATE "budget_revisions"
   SET "overhead_bp" = 1600, "updated_at" = now()
 WHERE "status" = 'draft' AND "overhead_bp" = 1300;
