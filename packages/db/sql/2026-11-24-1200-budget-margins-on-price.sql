-- Gastos asociados and beneficio industrial are now both a share of the selling price without VAT
-- (FRAMER, "Cálculo de gastos operativos y beneficio industrial": 75 % cost, 16 % gastos, 9 % beneficio):
-- price = cost ÷ (1 − gastos − beneficio), in packages/core/src/obra-calc.ts › unitPrice. The two together
-- must leave something for the cost, so the check on beneficio alone becomes one on their sum.
--
-- The new code divides by 10000 − overhead_bp − profit_bp; every row today is far below (16 % + 6 % or 9 %),
-- and the old code never reads the new constraint, so this file may go before or after the code.

-- Never queue the portal behind this file: if a lock is not free in 5 s it fails, whole, and is run again.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "budget_revisions" DROP CONSTRAINT IF EXISTS "budget_revisions_profit_bp_check";
ALTER TABLE "budget_revisions" DROP CONSTRAINT IF EXISTS "budget_revisions_margins_check";
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_margins_check"
  CHECK (profit_bp >= 0 AND overhead_bp + profit_bp < 10000) NOT VALID;
ALTER TABLE "budget_revisions" VALIDATE CONSTRAINT "budget_revisions_margins_check";
