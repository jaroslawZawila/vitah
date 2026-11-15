-- The CAE rules' result, stored (packages/core/src/subcontractor-attention.ts): each company's status and the
-- warnings each obra assignment gives its obra, each with the last day it holds. The project list then sums
-- them instead of reading every CAE document of the tenant.
--
-- Additive: four nullable columns, no index (a tenant has hundreds of assignments; the sum reads them by
-- tenant). Null means "never worked out": the first read after the deploy works each one out and stores it,
-- so there is nothing to backfill. The previous deployment never reads nor writes them.
--
-- After a rollback past this release, the code running meanwhile changes documents without refreshing the
-- values. Before (or right after) rolling forward again, forget them so they are worked out afresh:
--   UPDATE subcontractors SET cae_status = NULL, cae_valid_until = NULL;
--   UPDATE subcontractor_assignments SET cae_warnings = NULL, cae_valid_until = NULL;

-- Never queue the portal behind this file: if a lock is not free in 5 s it fails, whole, and is run again.
SET LOCAL lock_timeout = '5s';

ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS cae_status text;
ALTER TABLE subcontractors ADD COLUMN IF NOT EXISTS cae_valid_until date;
ALTER TABLE subcontractor_assignments ADD COLUMN IF NOT EXISTS cae_warnings integer;
ALTER TABLE subcontractor_assignments ADD COLUMN IF NOT EXISTS cae_valid_until date;
