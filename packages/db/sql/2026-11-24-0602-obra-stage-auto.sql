-- Prod data fix: the process's stage (1–8) now moves on its own with what the
-- platform records (packages/core/src/obra-stage.ts, rule in obra-calc.ts ›
-- stageEvidence). This catches existing projects up once: each stage rises to
-- the furthest one its records reach, never down (a stage staff set ahead
-- stays). No schema change; safe to re-run. Apply it after deploying.
--
--   2 a budget input registered     5 H0 paid
--   3 a budget revision             6 a contract chapter started on Avance
--   4 a revision accepted           7 every contract chapter finished
--                                   8 H9 paid

WITH contract AS (
  -- The accepted revision's built chapters (chosen options too), never 20.
  SELECT DISTINCT r.project_id, c.code
  FROM budget_revisions r
  JOIN budget_chapters c ON c.revision_id = r.id
  JOIN budget_lines l ON l.chapter_id = c.id
  WHERE r.status = 'accepted' AND (c.kind = 'chapter' OR c.chosen) AND c.code <> '20'
),
works AS (
  SELECT ct.project_id,
         bool_or(p.actual_start IS NOT NULL) AS started,
         bool_and(p.actual_end IS NOT NULL) AS finished
  FROM contract ct
  LEFT JOIN obra_chapter_progress p ON p.project_id = ct.project_id AND p.chapter_code = ct.code
  GROUP BY ct.project_id
),
evidence AS (
  SELECT pr.id,
         CASE
           WHEN EXISTS (SELECT 1 FROM obra_hitos h WHERE h.project_id = pr.id AND h.code = 'H9' AND h.paid_on IS NOT NULL) THEN 8
           WHEN w.finished THEN 7
           WHEN w.started THEN 6
           WHEN EXISTS (SELECT 1 FROM obra_hitos h WHERE h.project_id = pr.id AND h.code = 'H0' AND h.paid_on IS NOT NULL) THEN 5
           WHEN EXISTS (SELECT 1 FROM budget_revisions r WHERE r.project_id = pr.id AND r.status = 'accepted') THEN 4
           WHEN EXISTS (SELECT 1 FROM budget_revisions r WHERE r.project_id = pr.id) THEN 3
           WHEN EXISTS (SELECT 1 FROM project_documents d WHERE d.project_id = pr.id AND d.budget_input IS NOT NULL) THEN 2
           ELSE 1
         END AS stage
  FROM projects pr
  LEFT JOIN works w ON w.project_id = pr.id
)
UPDATE projects p
SET obra_stage = e.stage, obra_rev = p.obra_rev + 1, updated_at = now()
FROM evidence e
WHERE e.id = p.id AND p.obra_stage < e.stage;
