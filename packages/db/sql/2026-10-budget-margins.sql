-- Prod migration: the budget's margins (gastos asociados and beneficio
-- industrial) on top of the cost, in basis points. Additive only; safe to re-run.
-- Existing revisions keep 0: their unit prices already included both.

ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "overhead_bp" integer DEFAULT 0 NOT NULL;
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "profit_bp" integer DEFAULT 0 NOT NULL;
