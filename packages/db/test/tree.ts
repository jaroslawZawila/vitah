// One tenant with a row in every table under it, as the application writes
// them: for the constraint tests and the migration test. Ids end in `_<t>`.

/**
 * SQL inserting tenant `t`'s whole tree; with `fixtureOnly`, only the tables
 * and columns test/fixtures/schema-before-2026-11-15.sql has (the migration
 * test's database before the newer files run). A table newer than the fixture
 * goes in the second part.
 */
export function tenantTree(t: string, { fixtureOnly = false } = {}): string {
  const id = (name: string) => `'${name}_${t}'`;
  const T = `'${t}'`;
  const tree = `
    insert into tenants (id, name, slug) values (${T}, 'Tenant ${t}', 'tenant-${t}');
    insert into users (id, tenant_id, email, role) values
      (${id("admin")}, ${T}, 'admin-${t}@example.com', 'admin'),
      (${id("client")}, ${T}, 'client-${t}@example.com', 'client');
    insert into user_mfa (user_id, tenant_id, secret) values (${id("admin")}, ${T}, 'secret');
    insert into client_profiles (user_id, tenant_id, first_name, surnames) values (${id("client")}, ${T}, 'Ana', 'Ruiz');
    insert into client_settings (user_id, tenant_id) values (${id("client")}, ${T});
    insert into push_tokens (token, user_id, tenant_id, language) values (${id("token")}, ${id("client")}, ${T}, 'en');
    insert into idempotency_keys (tenant_id, scope, key, request_hash) values (${T}, 'purchase.payment.create', ${id("key")}, 'hash');

    insert into projects (id, tenant_id, ref, address, client_user_id, start_date, completion_date, obra_stage)
      values (${id("project")}, ${T}, 'VTH-${t}', 'Calle Mayor 1', ${id("client")}, '2026-01-01', '2026-12-31', 6);
    insert into project_documents (id, tenant_id, project_id, title, category, pathname, size_bytes, budget_input)
      values (${id("document")}, ${T}, ${id("project")}, 'Planos', 'budget', 'documents/${t}/plans.pdf', 1024, 'plans');
    insert into project_photos (id, tenant_id, project_id, pathname, content_type, size_bytes, thumb_size_bytes)
      values (${id("photo")}, ${T}, ${id("project")}, 'photos/${t}/1.jpg', 'image/jpeg', 2048, 512);

    insert into budget_revisions (id, tenant_id, project_id, number, status, model, quality, overhead_bp, profit_bp)
      values (${id("revision")}, ${T}, ${id("project")}, 0, 'accepted', 'framer20', 'framer', 1600, 600);
    insert into budget_chapters (id, tenant_id, revision_id, code, name, position, kind, option_kind) values
      (${id("chapter")}, ${T}, ${id("revision")}, '05', 'Estructura', 5, 'chapter', null),
      (${id("option")}, ${T}, ${id("revision")}, 'OP1', 'Opción', 21, 'option', 'deduction');
    insert into budget_lines (id, tenant_id, chapter_id, code, description, unit, quantity_milli, unit_price_cents, lineage_id, position, source, executed_pct) values
      (${id("line")}, ${T}, ${id("chapter")}, '05.01', 'Perfiles', 'kg', 1000, 250, ${id("lineage")}, 0, 'base', 40),
      (${id("deduction")}, ${T}, ${id("option")}, 'OP.01', 'Sin piscina', 'ud', 1000, -500000, ${id("lineage2")}, 0, 'manual', 0);

    insert into obra_hitos (id, tenant_id, project_id, code, name, pct_bp, scope, billing_moment, position, paid_on, paid_amount_cents)
      values (${id("hito")}, ${T}, ${id("project")}, 'H4', 'Estructura', 1300, 'scope', 'moment', 4, '2026-05-01', 100);
    insert into obra_hito_chapters (hito_id, tenant_id, project_id, chapter_code) values (${id("hito")}, ${T}, ${id("project")}, '05');
    insert into obra_hito_checks (id, tenant_id, hito_id, label, position) values (${id("check")}, ${T}, ${id("hito")}, 'Ensayo', 0);
    insert into obra_hito_photos (hito_id, photo_id, tenant_id) values (${id("hito")}, ${id("photo")}, ${T});
    insert into obra_hito_events (id, tenant_id, project_id, hito_id, action) values (${id("hito_event")}, ${T}, ${id("project")}, ${id("hito")}, 'payment_registered');
    insert into obra_invoice_requests (id, tenant_id, project_id, hito_id, chapter_code, amount_cents, description)
      values (${id("invoice_request")}, ${T}, ${id("project")}, ${id("hito")}, '05', 100, 'H4');
    insert into obra_chapter_progress (id, tenant_id, project_id, chapter_code, actual_start, actual_end)
      values (${id("progress")}, ${T}, ${id("project")}, '05', '2026-03-01', '2026-04-01');
    insert into obra_progress_events (id, tenant_id, project_id, chapter_code, kind, new_date)
      values (${id("progress_event")}, ${T}, ${id("project")}, '05', 'finish', '2026-04-01');
    insert into obra_issues (id, tenant_id, project_id, kind, number, occurred_on, chapter_code, description, party, cost_impact_cents)
      values (${id("issue")}, ${T}, ${id("project")}, 'change', 1, '2026-04-02', '05', 'Cambio', 'client', -5000);
    insert into obra_issue_files (id, tenant_id, issue_id, filename, pathname, content_type, size_bytes)
      values (${id("issue_file")}, ${T}, ${id("issue")}, 'a.pdf', 'issues/${t}/a.pdf', 'application/pdf', 10);

    insert into budget_generations (id, tenant_id, project_id, status, step, options, document_ids)
      values (${id("generation")}, ${T}, ${id("project")}, 'succeeded', 5, '{}', array[${id("document")}]);
    insert into ai_usage (id, tenant_id, project_id, generation_id, purpose, model, input_tokens, output_tokens, cost_micro_usd)
      values (${id("usage")}, ${T}, ${id("project")}, ${id("generation")}, 'budget.extract', 'model', 10, 20, 30);

    insert into subcontractors (id, tenant_id, kind, legal_name, tax_id, address, postal_code, city, province, rea_region, headcount, permanent_count, chain_level)
      values (${id("company")}, ${T}, 'company', 'Estructuras SL', 'B${t}', 'Calle 1', '39001', 'Santander', 'Cantabria', 'cb', 10, 4, 2);
    insert into subcontractor_workers (id, tenant_id, subcontractor_id, first_name, surnames, id_document)
      values (${id("worker")}, ${T}, ${id("company")}, 'Luis', 'Gómez', 'X${t}');
    insert into subcontractor_documents (id, tenant_id, subcontractor_id, worker_id, project_id, requirement_id, status)
      values (${id("cae")}, ${T}, ${id("company")}, ${id("worker")}, ${id("project")}, 'tpc', 'uploaded');
    insert into subcontractor_document_versions (id, tenant_id, document_id, version, pathname, filename, size_bytes)
      values (${id("cae_version")}, ${T}, ${id("cae")}, 1, 'cae/${t}/1.pdf', 'tpc.pdf', 100);
    insert into subcontractor_assignments (id, tenant_id, subcontractor_id, project_id, planned_start, planned_end)
      values (${id("assignment")}, ${T}, ${id("company")}, ${id("project")}, '2026-03-01', '2026-04-01');
    insert into subcontractor_audit (id, tenant_id, subcontractor_id, worker_id, action)
      values (${id("audit")}, ${T}, ${id("company")}, ${id("worker")}, 'created');

    insert into purchase_orders (id, tenant_id, project_id, number, kind, subcontractor_id, description, status, retention_bp, payment_days, vat_kind, work_start, work_end)
      values (${id("order")}, ${T}, ${id("project")}, 1, 'subcontract', ${id("company")}, 'Estructura', 'contracted', 500, 30, 'reverse_charge', '2026-03-01', '2026-04-01');
    insert into purchase_order_lines (id, tenant_id, order_id, lineage_id, chapter_code, amount_cents)
      values (${id("order_line")}, ${T}, ${id("order")}, ${id("lineage")}, '05', 1000);
    insert into purchase_order_events (id, tenant_id, order_id, action) values (${id("order_event")}, ${T}, ${id("order")}, 'created');
    insert into purchase_order_documents (id, tenant_id, order_id, title) values (${id("order_document")}, ${T}, ${id("order")}, 'Contrato');
    insert into purchase_order_document_versions (id, tenant_id, document_id, version, pathname, filename, size_bytes)
      values (${id("order_version")}, ${T}, ${id("order_document")}, 1, 'orders/${t}/1.pdf', 'contrato.pdf', 100);
    insert into purchase_order_milestones (id, tenant_id, order_id, position, concept, amount_cents)
      values (${id("milestone")}, ${T}, ${id("order")}, 0, 'Todo', 1000);
    insert into purchase_order_amendments (id, tenant_id, order_id, number, concept, signed_on, amount_before_cents, amount_after_cents, document_id)
      values (${id("amendment")}, ${T}, ${id("order")}, 1, 'Más', '2026-03-15', 900, 1000, ${id("order_document")});
    insert into purchase_invoices (id, tenant_id, order_id, subcontractor_id, number, milestone_id, issued_on, due_on, base_cents, vat_kind, vat_cents, retention_bp, retention_cents)
      values (${id("invoice")}, ${T}, ${id("order")}, ${id("company")}, 'F-1', ${id("milestone")}, '2026-04-01', '2026-05-01', 1000, 'reverse_charge', 0, 500, 50);
    insert into purchase_invoices (id, tenant_id, order_id, subcontractor_id, kind, number, rectifies_id, issued_on, base_cents, vat_kind, vat_cents)
      values (${id("credit")}, ${T}, ${id("order")}, ${id("company")}, 'credit_note', 'A-1', ${id("invoice")}, '2026-04-02', -100, 'reverse_charge', 0);
    insert into purchase_invoice_lines (id, tenant_id, invoice_id, lineage_id, chapter_code, amount_cents) values
      (${id("invoice_line")}, ${T}, ${id("invoice")}, ${id("lineage")}, '05', 1000),
      (${id("credit_line")}, ${T}, ${id("credit")}, ${id("lineage")}, '05', -100);
    insert into purchase_invoice_files (id, tenant_id, invoice_id, version, pathname, filename, size_bytes)
      values (${id("invoice_file")}, ${T}, ${id("invoice")}, 1, 'invoices/${t}/1.pdf', 'f1.pdf', 100);
    insert into purchase_payments (id, tenant_id, invoice_id, paid_on, amount_cents, method)
      values (${id("payment")}, ${T}, ${id("invoice")}, '2026-04-15', 800, 'transfer');
    insert into purchase_document_checks (id, tenant_id, order_id, payment_id, pathname, label, status) values
      (${id("payment_check")}, ${T}, ${id("order")}, ${id("payment")}, 'payments/${t}/1.pdf', 'Justificante', 'done');
    insert into purchase_document_checks (id, tenant_id, order_id, invoice_file_id, pathname, label) values
      (${id("invoice_check")}, ${T}, ${id("order")}, ${id("invoice_file")}, 'invoices/${t}/1.pdf', 'Factura');
    insert into purchase_document_checks (id, tenant_id, order_id, document_version_id, pathname, label) values
      (${id("version_check")}, ${T}, ${id("order")}, ${id("order_version")}, 'orders/${t}/1.pdf', 'Contrato');
    insert into purchase_requests (id, tenant_id, project_id, number, kind, description, status, order_id, subcontractor_id)
      values (${id("request")}, ${T}, ${id("project")}, 1, 'subcontract', 'Estructura', 'ordered', ${id("order")}, ${id("company")});
    insert into purchase_request_lines (id, tenant_id, request_id, lineage_id, chapter_code, amount_cents)
      values (${id("request_line")}, ${T}, ${id("request")}, ${id("lineage")}, '05', 1000);
    insert into purchase_request_events (id, tenant_id, request_id, action) values (${id("request_event")}, ${T}, ${id("request")}, 'created');

    insert into planning_versions (id, tenant_id, project_id, number, status, start_date, region)
      values (${id("plan")}, ${T}, ${id("project")}, 1, 'approved', '2026-01-01', 'cb');
    insert into planning_items (id, tenant_id, version_id, chapter_code, position, duration_days, lag_days, planned_start, planned_end)
      values (${id("plan_item")}, ${T}, ${id("plan")}, '05', 5, 20, -3, '2026-03-01', '2026-03-27');
  `;
  if (fixtureOnly) return tree;
  return `${tree}
    insert into warranty_claims (id, tenant_id, project_id, number, kind, room, description, urgent, status, visit_on, created_by_id)
      values (${id("claim")}, ${T}, ${id("project")}, 1, 'plumbing', 'bathroom', 'Gotea el grifo', true, 'scheduled', '2027-02-01', ${id("client")});
    insert into warranty_claim_photos (id, tenant_id, claim_id, pathname, content_type, size_bytes, thumb_size_bytes, uploaded_by_id)
      values (${id("claim_photo")}, ${T}, ${id("claim")}, 'warranty/${t}/1.jpg', 'image/jpeg', 2048, 512, ${id("client")});
    insert into warranty_claim_events (id, tenant_id, claim_id, user_id, action)
      values (${id("claim_event")}, ${T}, ${id("claim")}, ${id("client")}, 'created');
    insert into budget_exclusion_presets (id, tenant_id, label, position, created_by_id)
      values (${id("exclusion")}, ${T}, 'Licencia de obras', 0, ${id("admin")});

    insert into budget_revisions (id, tenant_id, project_id, number, status, model, change_reason)
      values (${id("revision1")}, ${T}, ${id("project")}, 1, 'issued', 'framer20', 'Cambio');
    insert into budget_revision_changes (tenant_id, revision_id, issue_id, linked_by_id)
      values (${T}, ${id("revision1")}, ${id("issue")}, ${id("admin")});
    insert into budget_approvals (id, tenant_id, project_id, revision_id, status, client_user_id, document_id, before_cents, after_cents, vat_rate_bp, asked_by_id, decided_by_id, decided_at)
      values (${id("approval")}, ${T}, ${id("project")}, ${id("revision1")}, 'approved', ${id("client")}, ${id("document")}, 1000, 1200, 1000, ${id("admin")}, ${id("client")}, now());
  `;
}

/** Every table of the tree that carries tenant_id. */
export const TENANT_TABLES = [
  "users",
  "user_mfa",
  "client_profiles",
  "client_settings",
  "push_tokens",
  "idempotency_keys",
  "projects",
  "project_documents",
  "project_photos",
  "budget_revisions",
  "budget_chapters",
  "budget_lines",
  "obra_hitos",
  "obra_hito_chapters",
  "obra_hito_checks",
  "obra_hito_photos",
  "obra_hito_events",
  "obra_invoice_requests",
  "obra_chapter_progress",
  "obra_progress_events",
  "obra_issues",
  "obra_issue_files",
  "budget_revision_changes",
  "budget_approvals",
  "budget_generations",
  "ai_usage",
  "subcontractors",
  "subcontractor_workers",
  "subcontractor_documents",
  "subcontractor_document_versions",
  "subcontractor_assignments",
  "subcontractor_audit",
  "purchase_orders",
  "purchase_order_lines",
  "purchase_order_events",
  "purchase_order_documents",
  "purchase_order_document_versions",
  "purchase_order_milestones",
  "purchase_order_amendments",
  "purchase_invoices",
  "purchase_invoice_lines",
  "purchase_invoice_files",
  "purchase_payments",
  "purchase_document_checks",
  "purchase_requests",
  "purchase_request_lines",
  "purchase_request_events",
  "planning_versions",
  "planning_items",
  "warranty_claims",
  "warranty_claim_photos",
  "warranty_claim_events",
  "budget_exclusion_presets",
];
