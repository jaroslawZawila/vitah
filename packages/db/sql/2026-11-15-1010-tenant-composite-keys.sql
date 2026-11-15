-- Tenant-composite keys: a row that carries tenant_id can only point at a parent of
-- the same tenant. Each tenant-owned parent gets UNIQUE (id, tenant_id) (19), and each
-- child's foreign key on the parent's id alone is replaced by (tenant_id, <column>) ->
-- parent (tenant_id, id) (56), with the same ON DELETE rule as before, except the 16
-- keys to projects: they stop cascading here (NO ACTION), so each child table is
-- scanned once. Why, and the keys schema.ts does not know: the next file,
-- 2026-11-15-1020-project-fk-no-cascade.sql.
--
-- The old keys are found by what they are (table, column, referenced table), never by
-- name: production's names differ from Drizzle's. The new ones are named as schema.ts
-- names them. Each new key is added NOT VALID, then validated on its own: one that
-- existing rows break (a child under another tenant's parent) stays NOT VALID, with a
-- NOTICE naming it, and the file goes on; new writes are checked either way.
-- Idempotent: what is already there is left as it is.

-- Never queue the portal behind this file: if a lock is not free in 5 s it fails, whole, and is run again.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  u record;
  f record;
  old record;
  child regclass;
  parent regclass;
  tenant_col smallint;
  ref_col smallint;
  parent_tenant smallint;
  parent_id smallint;
  pair smallint[];
BEGIN
  -- What the children reference.
  FOR u IN SELECT * FROM (VALUES
    ('budget_chapters', 'budget_chapters_id_tenant_id_unique'),
    ('budget_revisions', 'budget_revisions_id_tenant_id_unique'),
    ('obra_hitos', 'obra_hitos_id_tenant_id_unique'),
    ('obra_issues', 'obra_issues_id_tenant_id_unique'),
    ('planning_versions', 'planning_versions_id_tenant_id_unique'),
    ('project_photos', 'project_photos_id_tenant_id_unique'),
    ('projects', 'projects_id_tenant_id_unique'),
    ('purchase_invoice_files', 'purchase_invoice_files_id_tenant_id_unique'),
    ('purchase_invoices', 'purchase_invoices_id_tenant_id_unique'),
    ('purchase_order_document_versions', 'purchase_order_document_versions_id_tenant_id_unique'),
    ('purchase_order_documents', 'purchase_order_documents_id_tenant_id_unique'),
    ('purchase_order_milestones', 'purchase_order_milestones_id_tenant_id_unique'),
    ('purchase_orders', 'purchase_orders_id_tenant_id_unique'),
    ('purchase_payments', 'purchase_payments_id_tenant_id_unique'),
    ('purchase_requests', 'purchase_requests_id_tenant_id_unique'),
    ('subcontractor_documents', 'subcontractor_documents_id_tenant_id_unique'),
    ('subcontractor_workers', 'subcontractor_workers_id_tenant_id_unique'),
    ('subcontractors', 'subcontractors_id_tenant_id_unique'),
    ('users', 'users_id_tenant_id_unique')
  ) AS v(tbl, name) LOOP
    SELECT array_agg(attnum) INTO pair FROM pg_attribute
    WHERE attrelid = format('public.%I', u.tbl)::regclass AND attname IN ('id', 'tenant_id');
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint k
      WHERE k.conrelid = format('public.%I', u.tbl)::regclass AND k.contype IN ('u', 'p')
        AND (k.conname = u.name OR (k.conkey @> pair AND k.conkey <@ pair))
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (id, tenant_id)', u.tbl, u.name);
    END IF;
  END LOOP;

  FOR f IN SELECT * FROM (VALUES
    ('budget_chapters', 'budget_chapters_revision_id_tenant_fk', 'revision_id', 'budget_revisions', 'CASCADE'),
    ('budget_generations', 'budget_generations_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('budget_lines', 'budget_lines_chapter_id_tenant_fk', 'chapter_id', 'budget_chapters', 'CASCADE'),
    ('budget_revisions', 'budget_revisions_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('client_profiles', 'client_profiles_user_id_tenant_fk', 'user_id', 'users', 'CASCADE'),
    ('client_settings', 'client_settings_user_id_tenant_fk', 'user_id', 'users', 'CASCADE'),
    ('obra_chapter_progress', 'obra_chapter_progress_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('obra_hito_chapters', 'obra_hito_chapters_hito_id_tenant_fk', 'hito_id', 'obra_hitos', 'CASCADE'),
    ('obra_hito_chapters', 'obra_hito_chapters_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('obra_hito_checks', 'obra_hito_checks_hito_id_tenant_fk', 'hito_id', 'obra_hitos', 'CASCADE'),
    ('obra_hito_events', 'obra_hito_events_hito_id_tenant_fk', 'hito_id', 'obra_hitos', 'CASCADE'),
    ('obra_hito_events', 'obra_hito_events_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('obra_hito_photos', 'obra_hito_photos_hito_id_tenant_fk', 'hito_id', 'obra_hitos', 'CASCADE'),
    ('obra_hito_photos', 'obra_hito_photos_photo_id_tenant_fk', 'photo_id', 'project_photos', 'CASCADE'),
    ('obra_hitos', 'obra_hitos_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('obra_invoice_requests', 'obra_invoice_requests_hito_id_tenant_fk', 'hito_id', 'obra_hitos', 'CASCADE'),
    ('obra_invoice_requests', 'obra_invoice_requests_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('obra_issue_files', 'obra_issue_files_issue_id_tenant_fk', 'issue_id', 'obra_issues', 'CASCADE'),
    ('obra_issues', 'obra_issues_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('obra_progress_events', 'obra_progress_events_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('planning_items', 'planning_items_version_id_tenant_fk', 'version_id', 'planning_versions', 'CASCADE'),
    ('planning_versions', 'planning_versions_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('project_documents', 'project_documents_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('project_photos', 'project_photos_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('purchase_document_checks', 'purchase_document_checks_document_version_id_tenant_fk', 'document_version_id', 'purchase_order_document_versions', 'CASCADE'),
    ('purchase_document_checks', 'purchase_document_checks_invoice_file_id_tenant_fk', 'invoice_file_id', 'purchase_invoice_files', 'CASCADE'),
    ('purchase_document_checks', 'purchase_document_checks_order_id_tenant_fk', 'order_id', 'purchase_orders', 'CASCADE'),
    ('purchase_document_checks', 'purchase_document_checks_payment_id_tenant_fk', 'payment_id', 'purchase_payments', 'CASCADE'),
    ('purchase_invoice_files', 'purchase_invoice_files_invoice_id_tenant_fk', 'invoice_id', 'purchase_invoices', 'CASCADE'),
    ('purchase_invoice_lines', 'purchase_invoice_lines_invoice_id_tenant_fk', 'invoice_id', 'purchase_invoices', 'CASCADE'),
    ('purchase_invoices', 'purchase_invoices_milestone_id_tenant_fk', 'milestone_id', 'purchase_order_milestones', 'NO ACTION'),
    ('purchase_invoices', 'purchase_invoices_order_id_tenant_fk', 'order_id', 'purchase_orders', 'CASCADE'),
    ('purchase_invoices', 'purchase_invoices_rectifies_id_tenant_fk', 'rectifies_id', 'purchase_invoices', 'NO ACTION'),
    ('purchase_invoices', 'purchase_invoices_subcontractor_id_tenant_fk', 'subcontractor_id', 'subcontractors', 'NO ACTION'),
    ('purchase_order_amendments', 'purchase_order_amendments_order_id_tenant_fk', 'order_id', 'purchase_orders', 'CASCADE'),
    ('purchase_order_document_versions', 'purchase_order_document_versions_document_id_tenant_fk', 'document_id', 'purchase_order_documents', 'CASCADE'),
    ('purchase_order_documents', 'purchase_order_documents_order_id_tenant_fk', 'order_id', 'purchase_orders', 'CASCADE'),
    ('purchase_order_events', 'purchase_order_events_order_id_tenant_fk', 'order_id', 'purchase_orders', 'CASCADE'),
    ('purchase_order_lines', 'purchase_order_lines_order_id_tenant_fk', 'order_id', 'purchase_orders', 'CASCADE'),
    ('purchase_order_milestones', 'purchase_order_milestones_order_id_tenant_fk', 'order_id', 'purchase_orders', 'CASCADE'),
    ('purchase_orders', 'purchase_orders_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('purchase_orders', 'purchase_orders_subcontractor_id_tenant_fk', 'subcontractor_id', 'subcontractors', 'NO ACTION'),
    ('purchase_payments', 'purchase_payments_invoice_id_tenant_fk', 'invoice_id', 'purchase_invoices', 'CASCADE'),
    ('purchase_request_events', 'purchase_request_events_request_id_tenant_fk', 'request_id', 'purchase_requests', 'CASCADE'),
    ('purchase_request_lines', 'purchase_request_lines_request_id_tenant_fk', 'request_id', 'purchase_requests', 'CASCADE'),
    ('purchase_requests', 'purchase_requests_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('push_tokens', 'push_tokens_user_id_tenant_fk', 'user_id', 'users', 'CASCADE'),
    ('subcontractor_assignments', 'subcontractor_assignments_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('subcontractor_assignments', 'subcontractor_assignments_subcontractor_id_tenant_fk', 'subcontractor_id', 'subcontractors', 'CASCADE'),
    ('subcontractor_audit', 'subcontractor_audit_subcontractor_id_tenant_fk', 'subcontractor_id', 'subcontractors', 'CASCADE'),
    ('subcontractor_document_versions', 'subcontractor_document_versions_document_id_tenant_fk', 'document_id', 'subcontractor_documents', 'CASCADE'),
    ('subcontractor_documents', 'subcontractor_documents_project_id_tenant_fk', 'project_id', 'projects', 'NO ACTION'),
    ('subcontractor_documents', 'subcontractor_documents_subcontractor_id_tenant_fk', 'subcontractor_id', 'subcontractors', 'CASCADE'),
    ('subcontractor_documents', 'subcontractor_documents_worker_id_tenant_fk', 'worker_id', 'subcontractor_workers', 'CASCADE'),
    ('subcontractor_workers', 'subcontractor_workers_subcontractor_id_tenant_fk', 'subcontractor_id', 'subcontractors', 'CASCADE'),
    ('user_mfa', 'user_mfa_user_id_tenant_fk', 'user_id', 'users', 'CASCADE')
  ) AS v(tbl, name, col, parent, on_delete) LOOP
    child := format('public.%I', f.tbl)::regclass;
    parent := format('public.%I', f.parent)::regclass;
    SELECT attnum INTO tenant_col FROM pg_attribute WHERE attrelid = child AND attname = 'tenant_id';
    SELECT attnum INTO ref_col FROM pg_attribute WHERE attrelid = child AND attname = f.col;
    SELECT attnum INTO parent_tenant FROM pg_attribute WHERE attrelid = parent AND attname = 'tenant_id';
    SELECT attnum INTO parent_id FROM pg_attribute WHERE attrelid = parent AND attname = 'id';

    -- The key on the parent's id alone, under whatever name.
    FOR old IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = child AND contype = 'f' AND confrelid = parent
        AND conkey = ARRAY[ref_col] AND confkey = ARRAY[parent_id]
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', child, old.conname);
    END LOOP;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = child AND contype = 'f'
        AND (conname = f.name OR (confrelid = parent AND conkey = ARRAY[tenant_col, ref_col] AND confkey = ARRAY[parent_tenant, parent_id]))
    ) THEN
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) REFERENCES %s (tenant_id, id) ON DELETE %s NOT VALID',
        child, f.name, f.col, parent, f.on_delete
      );
    END IF;
  END LOOP;

  FOR f IN
    SELECT k.conrelid::regclass AS tbl, k.conname AS name
    FROM pg_constraint k
    WHERE k.contype = 'f' AND NOT k.convalidated AND k.connamespace = 'public'::regnamespace
      AND k.conname IN ('budget_chapters_revision_id_tenant_fk', 'budget_generations_project_id_tenant_fk', 'budget_lines_chapter_id_tenant_fk', 'budget_revisions_project_id_tenant_fk', 'client_profiles_user_id_tenant_fk', 'client_settings_user_id_tenant_fk', 'obra_chapter_progress_project_id_tenant_fk', 'obra_hito_chapters_hito_id_tenant_fk', 'obra_hito_chapters_project_id_tenant_fk', 'obra_hito_checks_hito_id_tenant_fk', 'obra_hito_events_hito_id_tenant_fk', 'obra_hito_events_project_id_tenant_fk', 'obra_hito_photos_hito_id_tenant_fk', 'obra_hito_photos_photo_id_tenant_fk', 'obra_hitos_project_id_tenant_fk', 'obra_invoice_requests_hito_id_tenant_fk', 'obra_invoice_requests_project_id_tenant_fk', 'obra_issue_files_issue_id_tenant_fk', 'obra_issues_project_id_tenant_fk', 'obra_progress_events_project_id_tenant_fk', 'planning_items_version_id_tenant_fk', 'planning_versions_project_id_tenant_fk', 'project_documents_project_id_tenant_fk', 'project_photos_project_id_tenant_fk', 'purchase_document_checks_document_version_id_tenant_fk', 'purchase_document_checks_invoice_file_id_tenant_fk', 'purchase_document_checks_order_id_tenant_fk', 'purchase_document_checks_payment_id_tenant_fk', 'purchase_invoice_files_invoice_id_tenant_fk', 'purchase_invoice_lines_invoice_id_tenant_fk', 'purchase_invoices_milestone_id_tenant_fk', 'purchase_invoices_order_id_tenant_fk', 'purchase_invoices_rectifies_id_tenant_fk', 'purchase_invoices_subcontractor_id_tenant_fk', 'purchase_order_amendments_order_id_tenant_fk', 'purchase_order_document_versions_document_id_tenant_fk', 'purchase_order_documents_order_id_tenant_fk', 'purchase_order_events_order_id_tenant_fk', 'purchase_order_lines_order_id_tenant_fk', 'purchase_order_milestones_order_id_tenant_fk', 'purchase_orders_project_id_tenant_fk', 'purchase_orders_subcontractor_id_tenant_fk', 'purchase_payments_invoice_id_tenant_fk', 'purchase_request_events_request_id_tenant_fk', 'purchase_request_lines_request_id_tenant_fk', 'purchase_requests_project_id_tenant_fk', 'push_tokens_user_id_tenant_fk', 'subcontractor_assignments_project_id_tenant_fk', 'subcontractor_assignments_subcontractor_id_tenant_fk', 'subcontractor_audit_subcontractor_id_tenant_fk', 'subcontractor_document_versions_document_id_tenant_fk', 'subcontractor_documents_project_id_tenant_fk', 'subcontractor_documents_subcontractor_id_tenant_fk', 'subcontractor_documents_worker_id_tenant_fk', 'subcontractor_workers_subcontractor_id_tenant_fk', 'user_mfa_user_id_tenant_fk')
    ORDER BY 1, 2
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', f.tbl, f.name);
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'NOT VALID: % on % (rows point at another tenant''s parent; see the preflight)', f.name, f.tbl;
    END;
  END LOOP;
END $$;
