-- Prod migration: Planning's order-by dates. Additive only; safe to re-run.
-- Each chapter of a plan says how many calendar days before its start its
-- orders must be placed (the suppliers' lead time); Compras shows the date.
-- Plans approved before this get the standard lead times (PLAN_TEMPLATE in
-- packages/core/src/planning-calc.ts), once, when the column is added.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'planning_items' AND column_name = 'lead_days'
  ) THEN
    ALTER TABLE "planning_items" ADD COLUMN "lead_days" integer DEFAULT 0 NOT NULL;
    UPDATE "planning_items" SET "lead_days" = CASE "chapter_code"
      WHEN '01' THEN 7 WHEN '02' THEN 14 WHEN '03' THEN 42 WHEN '04' THEN 14
      WHEN '05' THEN 21 WHEN '06' THEN 42 WHEN '07' THEN 14 WHEN '08' THEN 21
      WHEN '09' THEN 14 WHEN '10' THEN 56 WHEN '11' THEN 21 WHEN '12' THEN 42
      WHEN '13' THEN 14 WHEN '14' THEN 14 WHEN '15' THEN 14 WHEN '16' THEN 7
      ELSE 14 END
    WHERE NOT "spans_works";
  END IF;
END $$;
