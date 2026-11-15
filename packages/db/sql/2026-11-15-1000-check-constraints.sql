-- CHECK constraints: the values and ranges the application already guarantees, now
-- also refused by the database (schema.ts: COLUMN_VALUES, `oneOf`, …). 82 constraints.
--
-- Each is added NOT VALID (new writes are checked at once, rows already there are not),
-- then validated on its own: one that existing rows break stays NOT VALID, with a NOTICE
-- naming it, and the file goes on. `pnpm db:drift` lists what stays NOT VALID; fix those
-- rows (the preflight finds them) and run `ALTER TABLE … VALIDATE CONSTRAINT …`.
-- Idempotent: a constraint already there (by name) is left as it is.

-- Never queue the portal behind this file: if a lock is not free in 5 s it fails, whole, and is run again.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('tenants', 'tenants_ai_monthly_limit_cents_check', $c$ai_monthly_limit_cents >= 0$c$),
    ('users', 'users_language_check', $c$language IN ('es', 'en')$c$),
    ('login_attempts', 'login_attempts_failures_check', $c$failures >= 0$c$),
    ('push_tokens', 'push_tokens_language_check', $c$language IN ('es', 'en')$c$),
    ('projects', 'projects_obra_stage_check', $c$obra_stage BETWEEN 1 AND 8$c$),
    ('projects', 'projects_dates_check', $c$completion_date >= start_date$c$),
    ('projects', 'projects_deleted_check', $c$deleted_by_id IS NULL OR deleted_at IS NOT NULL$c$),
    ('project_documents', 'project_documents_budget_input_check', $c$budget_input IN ('plans', 'basic', 'execution', 'measurements')$c$),
    ('project_documents', 'project_documents_budget_pdf_check', $c$budget_pdf IN ('general', 'detailed')$c$),
    ('project_documents', 'project_documents_size_bytes_check', $c$size_bytes >= 0$c$),
    ('project_documents', 'project_documents_deleted_check', $c$deleted_by_id IS NULL OR deleted_at IS NOT NULL$c$),
    ('project_photos', 'project_photos_size_bytes_check', $c$size_bytes >= 0 AND thumb_size_bytes >= 0$c$),
    ('project_photos', 'project_photos_deleted_check', $c$deleted_by_id IS NULL OR deleted_at IS NOT NULL$c$),
    ('budget_revisions', 'budget_revisions_number_check', $c$number >= 0$c$),
    ('budget_revisions', 'budget_revisions_model_check', $c$model IN ('framer20')$c$),
    ('budget_revisions', 'budget_revisions_quality_check', $c$quality IN ('framer', 'project')$c$),
    ('budget_revisions', 'budget_revisions_vat_rate_bp_check', $c$vat_rate_bp BETWEEN 0 AND 10000$c$),
    ('budget_revisions', 'budget_revisions_contingency_bp_check', $c$contingency_bp BETWEEN 0 AND 10000$c$),
    ('budget_revisions', 'budget_revisions_overhead_bp_check', $c$overhead_bp BETWEEN 0 AND 10000$c$),
    ('budget_revisions', 'budget_revisions_profit_bp_check', $c$profit_bp >= 0 AND profit_bp < 10000$c$),
    ('budget_revisions', 'budget_revisions_areas_check', $c$built_area_cm2 >= 0 AND useful_area_cm2 >= 0$c$),
    ('budget_chapters', 'budget_chapters_kind_check', $c$kind IN ('chapter', 'option')$c$),
    ('budget_chapters', 'budget_chapters_option_kind_check', $c$option_kind IN ('extra', 'alternative', 'deduction')$c$),
    ('budget_lines', 'budget_lines_source_check', $c$source IN ('base', 'estimated', 'manual', 'computed')$c$),
    ('budget_lines', 'budget_lines_quantity_milli_check', $c$quantity_milli >= 0$c$),
    ('budget_lines', 'budget_lines_executed_pct_check', $c$executed_pct BETWEEN 0 AND 100$c$),
    ('obra_hitos', 'obra_hitos_pct_bp_check', $c$pct_bp BETWEEN 0 AND 10000$c$),
    ('obra_hitos', 'obra_hitos_sizes_check', $c$acta_size_bytes >= 0 AND invoice_size_bytes >= 0$c$),
    ('obra_hitos', 'obra_hitos_payment_check', $c$(paid_on IS NULL) = (paid_amount_cents IS NULL) AND paid_amount_cents > 0$c$),
    ('obra_chapter_progress', 'obra_chapter_progress_dates_check', $c$actual_end IS NULL OR (actual_start IS NOT NULL AND actual_end >= actual_start)$c$),
    ('obra_progress_events', 'obra_progress_events_kind_check', $c$kind IN ('start', 'finish', 'correct_start', 'correct_finish')$c$),
    ('obra_invoice_requests', 'obra_invoice_requests_amount_cents_check', $c$amount_cents >= 0$c$),
    ('obra_hito_events', 'obra_hito_events_action_check', $c$action IN ('acta_uploaded', 'acta_removed', 'invoice_uploaded', 'invoice_removed', 'payment_registered', 'payment_cancelled')$c$),
    ('obra_issues', 'obra_issues_kind_check', $c$kind IN ('issue', 'change')$c$),
    ('obra_issues', 'obra_issues_party_check', $c$party IN ('client', 'subcontractor', 'own', 'other')$c$),
    ('obra_issues', 'obra_issues_status_check', $c$status IN ('pending', 'review', 'resolved')$c$),
    ('obra_issues', 'obra_issues_number_check', $c$number >= 1$c$),
    ('obra_issue_files', 'obra_issue_files_size_bytes_check', $c$size_bytes >= 0$c$),
    ('obra_issue_files', 'obra_issue_files_deleted_check', $c$deleted_by_id IS NULL OR deleted_at IS NOT NULL$c$),
    ('budget_generations', 'budget_generations_status_check', $c$status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')$c$),
    ('budget_generations', 'budget_generations_step_check', $c$step BETWEEN 0 AND 5$c$),
    ('ai_usage', 'ai_usage_counts_check', $c$input_tokens >= 0 AND output_tokens >= 0 AND cache_read_tokens >= 0 AND cache_write_tokens >= 0 AND cost_micro_usd >= 0$c$),
    ('subcontractors', 'subcontractors_chain_level_check', $c$chain_level BETWEEN 1 AND 3$c$),
    ('subcontractors', 'subcontractors_headcount_check', $c$headcount >= 0 AND permanent_count >= 0 AND permanent_count <= headcount$c$),
    ('subcontractors', 'subcontractors_cae_status_check', $c$cae_status IN ('apta', 'pendiente', 'bloqueada')$c$),
    ('subcontractor_document_versions', 'subcontractor_document_versions_version_check', $c$version >= 1 AND size_bytes >= 0$c$),
    ('subcontractor_assignments', 'subcontractor_assignments_dates_check', $c$planned_end >= planned_start$c$),
    ('subcontractor_assignments', 'subcontractor_assignments_deleted_check', $c$deleted_by_id IS NULL OR deleted_at IS NOT NULL$c$),
    ('subcontractor_assignments', 'subcontractor_assignments_cae_warnings_check', $c$cae_warnings >= 0$c$),
    ('purchase_orders', 'purchase_orders_kind_check', $c$kind IN ('material', 'subcontract')$c$),
    ('purchase_orders', 'purchase_orders_status_check', $c$(kind = 'material' AND status IN ('pending', 'ordered', 'confirmed', 'in_transit', 'delivered', 'cancelled')) OR (kind = 'subcontract' AND status IN ('pending', 'contracted', 'finished', 'cancelled'))$c$),
    ('purchase_orders', 'purchase_orders_vat_kind_check', $c$vat_kind IN ('vat21', 'vat10', 'reverse_charge', 'exempt')$c$),
    ('purchase_orders', 'purchase_orders_number_check', $c$number >= 1$c$),
    ('purchase_orders', 'purchase_orders_terms_check', $c$payment_days >= 0 AND retention_bp BETWEEN 0 AND 10000 AND file_size_bytes >= 0$c$),
    ('purchase_orders', 'purchase_orders_work_dates_check', $c$work_end >= work_start$c$),
    ('purchase_order_lines', 'purchase_order_lines_amount_cents_check', $c$amount_cents > 0$c$),
    ('purchase_order_documents', 'purchase_order_documents_deleted_check', $c$deleted_by_id IS NULL OR deleted_at IS NOT NULL$c$),
    ('purchase_order_document_versions', 'purchase_order_document_versions_version_check', $c$version >= 1 AND size_bytes >= 0$c$),
    ('purchase_requests', 'purchase_requests_kind_check', $c$kind IN ('material', 'subcontract')$c$),
    ('purchase_requests', 'purchase_requests_status_check', $c$status IN ('pending', 'approved', 'rejected', 'ordered', 'cancelled')$c$),
    ('purchase_requests', 'purchase_requests_number_check', $c$number >= 1$c$),
    ('purchase_request_lines', 'purchase_request_lines_amount_cents_check', $c$amount_cents > 0$c$),
    ('purchase_order_milestones', 'purchase_order_milestones_amount_cents_check', $c$amount_cents > 0$c$),
    ('purchase_order_amendments', 'purchase_order_amendments_number_check', $c$number >= 1$c$),
    ('purchase_invoices', 'purchase_invoices_kind_check', $c$(kind = 'invoice' AND base_cents > 0 AND rectifies_id IS NULL) OR (kind = 'credit_note' AND base_cents < 0 AND rectifies_id IS NOT NULL AND due_on IS NULL)$c$),
    ('purchase_invoices', 'purchase_invoices_vat_kind_check', $c$vat_kind IN ('vat21', 'vat10', 'reverse_charge', 'exempt')$c$),
    ('purchase_invoices', 'purchase_invoices_rates_check', $c$irpf_bp BETWEEN 0 AND 10000 AND retention_bp BETWEEN 0 AND 10000$c$),
    ('purchase_invoices', 'purchase_invoices_dates_check', $c$due_on >= issued_on$c$),
    ('purchase_invoices', 'purchase_invoices_deleted_check', $c$deleted_by_id IS NULL OR deleted_at IS NOT NULL$c$),
    ('purchase_invoice_lines', 'purchase_invoice_lines_amount_cents_check', $c$amount_cents <> 0$c$),
    ('purchase_invoice_files', 'purchase_invoice_files_version_check', $c$version >= 1 AND size_bytes >= 0$c$),
    ('purchase_payments', 'purchase_payments_amount_cents_check', $c$amount_cents > 0 AND file_size_bytes >= 0$c$),
    ('purchase_payments', 'purchase_payments_method_check', $c$method IN ('transfer', 'confirming', 'promissory_note', 'direct_debit')$c$),
    ('purchase_payments', 'purchase_payments_deleted_check', $c$deleted_by_id IS NULL OR deleted_at IS NOT NULL$c$),
    ('purchase_document_checks', 'purchase_document_checks_subject_check', $c$num_nonnulls(document_version_id, invoice_file_id, payment_id) = 1$c$),
    ('purchase_document_checks', 'purchase_document_checks_status_check', $c$status IN ('pending', 'running', 'done', 'failed', 'skipped')$c$),
    ('planning_versions', 'planning_versions_status_check', $c$status IN ('draft', 'approved', 'superseded')$c$),
    ('planning_versions', 'planning_versions_region_check', $c$region IN ('as', 'cb', 'cl', 'ga', 'md')$c$),
    ('planning_versions', 'planning_versions_number_check', $c$number >= 1$c$),
    ('planning_items', 'planning_items_days_check', $c$duration_days >= 1 AND lead_days >= 0$c$),
    ('planning_items', 'planning_items_dates_check', $c$planned_end >= planned_start$c$)
  ) AS v(tbl, name, expr) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid = format('public.%I', c.tbl)::regclass AND conname = c.name
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;

  FOR c IN
    SELECT k.conrelid::regclass AS tbl, k.conname AS name
    FROM pg_constraint k
    WHERE k.contype = 'c' AND NOT k.convalidated AND k.connamespace = 'public'::regnamespace
      AND k.conname IN ('tenants_ai_monthly_limit_cents_check', 'users_language_check', 'login_attempts_failures_check', 'push_tokens_language_check', 'projects_obra_stage_check', 'projects_dates_check', 'projects_deleted_check', 'project_documents_budget_input_check', 'project_documents_budget_pdf_check', 'project_documents_size_bytes_check', 'project_documents_deleted_check', 'project_photos_size_bytes_check', 'project_photos_deleted_check', 'budget_revisions_number_check', 'budget_revisions_model_check', 'budget_revisions_quality_check', 'budget_revisions_vat_rate_bp_check', 'budget_revisions_contingency_bp_check', 'budget_revisions_overhead_bp_check', 'budget_revisions_profit_bp_check', 'budget_revisions_areas_check', 'budget_chapters_kind_check', 'budget_chapters_option_kind_check', 'budget_lines_source_check', 'budget_lines_quantity_milli_check', 'budget_lines_executed_pct_check', 'obra_hitos_pct_bp_check', 'obra_hitos_sizes_check', 'obra_hitos_payment_check', 'obra_chapter_progress_dates_check', 'obra_progress_events_kind_check', 'obra_invoice_requests_amount_cents_check', 'obra_hito_events_action_check', 'obra_issues_kind_check', 'obra_issues_party_check', 'obra_issues_status_check', 'obra_issues_number_check', 'obra_issue_files_size_bytes_check', 'obra_issue_files_deleted_check', 'budget_generations_status_check', 'budget_generations_step_check', 'ai_usage_counts_check', 'subcontractors_chain_level_check', 'subcontractors_headcount_check', 'subcontractors_cae_status_check', 'subcontractor_document_versions_version_check', 'subcontractor_assignments_dates_check', 'subcontractor_assignments_deleted_check', 'subcontractor_assignments_cae_warnings_check', 'purchase_orders_kind_check', 'purchase_orders_status_check', 'purchase_orders_vat_kind_check', 'purchase_orders_number_check', 'purchase_orders_terms_check', 'purchase_orders_work_dates_check', 'purchase_order_lines_amount_cents_check', 'purchase_order_documents_deleted_check', 'purchase_order_document_versions_version_check', 'purchase_requests_kind_check', 'purchase_requests_status_check', 'purchase_requests_number_check', 'purchase_request_lines_amount_cents_check', 'purchase_order_milestones_amount_cents_check', 'purchase_order_amendments_number_check', 'purchase_invoices_kind_check', 'purchase_invoices_vat_kind_check', 'purchase_invoices_rates_check', 'purchase_invoices_dates_check', 'purchase_invoices_deleted_check', 'purchase_invoice_lines_amount_cents_check', 'purchase_invoice_files_version_check', 'purchase_payments_amount_cents_check', 'purchase_payments_method_check', 'purchase_payments_deleted_check', 'purchase_document_checks_subject_check', 'purchase_document_checks_status_check', 'planning_versions_status_check', 'planning_versions_region_check', 'planning_versions_number_check', 'planning_items_days_check', 'planning_items_dates_check')
    ORDER BY 1, 2
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.name);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'NOT VALID: % on % (existing rows break it; see the preflight)', c.name, c.tbl;
    END;
  END LOOP;
END $$;
