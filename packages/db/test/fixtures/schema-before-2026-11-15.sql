-- The schema as it was before 2026-11-15-1000-check-constraints.sql: schema.ts of main at 5b9f7b1
-- (the last migration then was 2026-11-14-1710-user-mfa.sql), built with `drizzle-kit push` and dumped
-- with `pg_dump --schema-only --no-owner --no-privileges --no-comments` (SET lines and comments
-- removed). Frozen on purpose: integrity-migrations.test.ts applies every migration newer than it
-- and checks the result is what schema.ts builds. Never edit it.

CREATE TYPE public.budget_revision_status AS ENUM (
    'draft',
    'accepted',
    'superseded',
    'issued',
    'rejected'
);

CREATE TYPE public.document_category AS ENUM (
    'contract',
    'plans',
    'certificates',
    'other',
    'budget'
);

CREATE TYPE public.prevention_mode AS ENUM (
    'external_service',
    'own_service',
    'joint_service',
    'employer'
);

CREATE TYPE public.subcontractor_doc_status AS ENUM (
    'requested',
    'uploaded',
    'validated',
    'rejected',
    'not_applicable'
);

CREATE TYPE public.subcontractor_kind AS ENUM (
    'company',
    'self_employed'
);

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'manager',
    'viewer',
    'client'
);

CREATE TABLE public.accounts (
    id text NOT NULL,
    user_id text NOT NULL,
    type text NOT NULL,
    provider text NOT NULL,
    provider_account_id text NOT NULL,
    refresh_token text,
    access_token text,
    expires_at integer,
    token_type text,
    scope text,
    id_token text,
    session_state text
);

CREATE TABLE public.ai_usage (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text,
    project_id text,
    generation_id text,
    purpose text NOT NULL,
    model text NOT NULL,
    input_tokens integer NOT NULL,
    output_tokens integer NOT NULL,
    cache_read_tokens integer DEFAULT 0 NOT NULL,
    cache_write_tokens integer DEFAULT 0 NOT NULL,
    cost_micro_usd bigint NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.budget_chapters (
    id text NOT NULL,
    tenant_id text NOT NULL,
    revision_id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    "position" integer NOT NULL,
    change_note text,
    kind text DEFAULT 'chapter'::text NOT NULL,
    pdf_note text,
    option_kind text,
    replaces_line text,
    chosen boolean
);

CREATE TABLE public.budget_generations (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    status text NOT NULL,
    step integer DEFAULT 0 NOT NULL,
    log jsonb DEFAULT '[]'::jsonb NOT NULL,
    options jsonb NOT NULL,
    document_ids text[] NOT NULL,
    extracted jsonb,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    revision_id text,
    workflow_run_id text,
    error text,
    created_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.budget_lines (
    id text NOT NULL,
    tenant_id text NOT NULL,
    chapter_id text NOT NULL,
    code text NOT NULL,
    description text NOT NULL,
    unit text NOT NULL,
    quantity_milli integer NOT NULL,
    unit_price_cents integer NOT NULL,
    executed_pct integer DEFAULT 0 NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    base_code text,
    note text,
    lineage_id text NOT NULL,
    "position" integer NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.budget_revisions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    number integer NOT NULL,
    status public.budget_revision_status DEFAULT 'draft'::public.budget_revision_status NOT NULL,
    reference text,
    vat_rate_bp integer DEFAULT 1000 NOT NULL,
    built_area_cm2 integer,
    useful_area_cm2 integer,
    exclusions text,
    model text,
    contingency_bp integer DEFAULT 500 NOT NULL,
    overhead_bp integer DEFAULT 0 NOT NULL,
    profit_bp integer DEFAULT 0 NOT NULL,
    quality text,
    texts jsonb,
    conditions jsonb,
    review jsonb,
    change_reason text,
    issued_on date,
    valid_until date,
    accepted_on date,
    accepted_by text,
    accepted_by_user_id text,
    accepted_document_id text,
    rejected_on date,
    generation_id text,
    accepted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.client_profiles (
    user_id text NOT NULL,
    tenant_id text NOT NULL,
    first_name text NOT NULL,
    surnames text NOT NULL,
    date_of_birth date,
    address text,
    phone text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.client_settings (
    user_id text NOT NULL,
    tenant_id text NOT NULL,
    notify_progress boolean DEFAULT true NOT NULL,
    notify_documents boolean DEFAULT true NOT NULL,
    notify_messages boolean DEFAULT true NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.idempotency_keys (
    tenant_id text NOT NULL,
    scope text NOT NULL,
    key text NOT NULL,
    user_id text,
    request_hash text NOT NULL,
    result jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.login_attempts (
    key text NOT NULL,
    failures integer DEFAULT 0 NOT NULL,
    window_start timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.obra_chapter_progress (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    chapter_code text NOT NULL,
    actual_start date,
    actual_end date,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.obra_hito_chapters (
    hito_id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    chapter_code text NOT NULL
);

CREATE TABLE public.obra_hito_checks (
    id text NOT NULL,
    tenant_id text NOT NULL,
    hito_id text NOT NULL,
    label text NOT NULL,
    done boolean DEFAULT false NOT NULL,
    "position" integer NOT NULL
);

CREATE TABLE public.obra_hito_events (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    hito_id text NOT NULL,
    user_id text,
    action text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.obra_hito_photos (
    hito_id text NOT NULL,
    photo_id text NOT NULL,
    tenant_id text NOT NULL
);

CREATE TABLE public.obra_hitos (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    pct_bp integer NOT NULL,
    scope text NOT NULL,
    billing_moment text NOT NULL,
    "position" integer NOT NULL,
    acta_signed_on date,
    acta_pathname text,
    acta_size_bytes integer,
    invoiced_on date,
    invoice_pathname text,
    invoice_size_bytes integer,
    paid_on date,
    paid_amount_cents integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.obra_invoice_requests (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    hito_id text NOT NULL,
    chapter_code text NOT NULL,
    amount_cents integer NOT NULL,
    description text NOT NULL,
    client_name text,
    requested_by_id text,
    requested_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.obra_issue_files (
    id text NOT NULL,
    tenant_id text NOT NULL,
    issue_id text NOT NULL,
    filename text NOT NULL,
    pathname text NOT NULL,
    content_type text NOT NULL,
    size_bytes integer NOT NULL,
    uploaded_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    deleted_by_id text
);

CREATE TABLE public.obra_issues (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    kind text NOT NULL,
    number integer NOT NULL,
    occurred_on date NOT NULL,
    chapter_code text NOT NULL,
    description text NOT NULL,
    party text NOT NULL,
    party_name text,
    cost_impact_cents integer,
    schedule_impact_days integer,
    status text DEFAULT 'pending'::text NOT NULL,
    created_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.obra_progress_events (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    chapter_code text NOT NULL,
    kind text NOT NULL,
    previous_date date,
    new_date date,
    note text,
    recorded_by_id text,
    recorded_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.planning_items (
    id text NOT NULL,
    tenant_id text NOT NULL,
    version_id text NOT NULL,
    chapter_code text NOT NULL,
    "position" integer NOT NULL,
    after_code text,
    lag_days integer DEFAULT 0 NOT NULL,
    duration_days integer NOT NULL,
    fixed_start date,
    spans_works boolean DEFAULT false NOT NULL,
    lead_days integer DEFAULT 0 NOT NULL,
    planned_start date NOT NULL,
    planned_end date NOT NULL
);

CREATE TABLE public.planning_versions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    number integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    start_date date NOT NULL,
    region text,
    august_closure boolean DEFAULT true NOT NULL,
    christmas_closure boolean DEFAULT true NOT NULL,
    reason text,
    created_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    approved_by_id text,
    approved_at timestamp without time zone
);

CREATE TABLE public.project_documents (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    title text NOT NULL,
    category public.document_category NOT NULL,
    pathname text NOT NULL,
    size_bytes integer NOT NULL,
    visible_to_client boolean DEFAULT true NOT NULL,
    content_type text DEFAULT 'application/pdf'::text NOT NULL,
    filename text,
    budget_input text,
    budget_revision_id text,
    budget_pdf text,
    client_notified_at timestamp without time zone,
    claude_file_id text,
    uploaded_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    deleted_by_id text
);

CREATE TABLE public.project_photos (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    caption text,
    pathname text NOT NULL,
    content_type text NOT NULL,
    size_bytes integer NOT NULL,
    chapter_code text,
    taken_on date,
    thumb_size_bytes integer,
    visible_to_client boolean DEFAULT true NOT NULL,
    client_notified_at timestamp without time zone,
    uploaded_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    deleted_by_id text
);

CREATE TABLE public.projects (
    id text NOT NULL,
    tenant_id text NOT NULL,
    ref text NOT NULL,
    address text NOT NULL,
    start_date timestamp without time zone,
    completion_date timestamp without time zone,
    obra_stage integer DEFAULT 1 NOT NULL,
    obra_reviewed_revision_id text,
    client_user_id text,
    project_rev integer DEFAULT 0 NOT NULL,
    obra_rev integer DEFAULT 0 NOT NULL,
    photos_rev integer DEFAULT 0 NOT NULL,
    documents_rev integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    deleted_by_id text
);

CREATE TABLE public.purchase_document_checks (
    id text NOT NULL,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    document_version_id text,
    invoice_file_id text,
    payment_id text,
    pathname text NOT NULL,
    label text NOT NULL,
    sha256 text,
    status text DEFAULT 'pending'::text NOT NULL,
    findings jsonb DEFAULT '[]'::jsonb NOT NULL,
    reason text,
    started_at timestamp without time zone,
    checked_at timestamp without time zone,
    dismissed_at timestamp without time zone,
    dismissed_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.purchase_invoice_files (
    id text NOT NULL,
    tenant_id text NOT NULL,
    invoice_id text NOT NULL,
    version integer NOT NULL,
    pathname text NOT NULL,
    filename text NOT NULL,
    size_bytes integer NOT NULL,
    note text,
    uploaded_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.purchase_invoice_lines (
    id text NOT NULL,
    tenant_id text NOT NULL,
    invoice_id text NOT NULL,
    lineage_id text NOT NULL,
    chapter_code text NOT NULL,
    amount_cents integer NOT NULL
);

CREATE TABLE public.purchase_invoices (
    id text NOT NULL,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    subcontractor_id text NOT NULL,
    kind text DEFAULT 'invoice'::text NOT NULL,
    number text NOT NULL,
    milestone_id text,
    rectifies_id text,
    issued_on date NOT NULL,
    due_on date,
    base_cents integer NOT NULL,
    vat_kind text NOT NULL,
    vat_cents integer NOT NULL,
    irpf_bp integer DEFAULT 0 NOT NULL,
    irpf_cents integer DEFAULT 0 NOT NULL,
    retention_bp integer DEFAULT 0 NOT NULL,
    retention_cents integer DEFAULT 0 NOT NULL,
    notes text,
    created_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    deleted_by_id text
);

CREATE TABLE public.purchase_order_amendments (
    id text NOT NULL,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    number integer NOT NULL,
    concept text NOT NULL,
    signed_on date NOT NULL,
    amount_before_cents integer NOT NULL,
    amount_after_cents integer NOT NULL,
    changes jsonb DEFAULT '[]'::jsonb NOT NULL,
    document_id text,
    created_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.purchase_order_document_versions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    document_id text NOT NULL,
    version integer NOT NULL,
    pathname text NOT NULL,
    filename text NOT NULL,
    size_bytes integer NOT NULL,
    note text,
    uploaded_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.purchase_order_documents (
    id text NOT NULL,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    title text NOT NULL,
    created_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    deleted_by_id text
);

CREATE TABLE public.purchase_order_events (
    id text NOT NULL,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    action text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    note text,
    user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.purchase_order_lines (
    id text NOT NULL,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    lineage_id text NOT NULL,
    chapter_code text NOT NULL,
    amount_cents integer NOT NULL,
    closes_line boolean DEFAULT true NOT NULL
);

CREATE TABLE public.purchase_order_milestones (
    id text NOT NULL,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    "position" integer NOT NULL,
    concept text NOT NULL,
    amount_cents integer NOT NULL
);

CREATE TABLE public.purchase_orders (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    number integer NOT NULL,
    kind text NOT NULL,
    subcontractor_id text NOT NULL,
    description text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    ordered_on date,
    expected_on date,
    work_start date,
    work_end date,
    completed_on date,
    notes text,
    payment_days integer,
    retention_bp integer DEFAULT 0 NOT NULL,
    vat_kind text,
    file_name text,
    file_pathname text,
    file_size_bytes integer,
    created_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.purchase_payments (
    id text NOT NULL,
    tenant_id text NOT NULL,
    invoice_id text NOT NULL,
    paid_on date NOT NULL,
    amount_cents integer NOT NULL,
    method text NOT NULL,
    reference text,
    file_name text,
    file_pathname text,
    file_size_bytes integer,
    created_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    deleted_by_id text
);

CREATE TABLE public.purchase_request_events (
    id text NOT NULL,
    tenant_id text NOT NULL,
    request_id text NOT NULL,
    action text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    note text,
    user_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.purchase_request_lines (
    id text NOT NULL,
    tenant_id text NOT NULL,
    request_id text NOT NULL,
    lineage_id text NOT NULL,
    chapter_code text NOT NULL,
    amount_cents integer NOT NULL
);

CREATE TABLE public.purchase_requests (
    id text NOT NULL,
    tenant_id text NOT NULL,
    project_id text NOT NULL,
    number integer NOT NULL,
    kind text NOT NULL,
    description text NOT NULL,
    needed_by date,
    subcontractor_id text,
    notes text,
    status text DEFAULT 'pending'::text NOT NULL,
    decided_by_id text,
    decided_at timestamp without time zone,
    decision_note text,
    order_id text,
    created_by_id text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.push_tokens (
    token text NOT NULL,
    language text DEFAULT 'es'::text NOT NULL,
    user_id text NOT NULL,
    tenant_id text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sessions (
    id text NOT NULL,
    session_token text NOT NULL,
    user_id text NOT NULL,
    expires timestamp without time zone NOT NULL
);

CREATE TABLE public.subcontractor_assignments (
    id text NOT NULL,
    tenant_id text NOT NULL,
    subcontractor_id text NOT NULL,
    project_id text NOT NULL,
    chapter_codes jsonb DEFAULT '[]'::jsonb NOT NULL,
    planned_start date,
    planned_end date,
    book_order integer,
    book_date date,
    css_informed boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    deleted_by_id text
);

CREATE TABLE public.subcontractor_audit (
    id text NOT NULL,
    tenant_id text NOT NULL,
    subcontractor_id text NOT NULL,
    worker_id text,
    user_id text,
    action text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.subcontractor_document_versions (
    id text NOT NULL,
    tenant_id text NOT NULL,
    document_id text NOT NULL,
    version integer NOT NULL,
    pathname text NOT NULL,
    filename text NOT NULL,
    size_bytes integer NOT NULL,
    issued_at date,
    expires_at date,
    uploaded_by_id text,
    reviewed_by_id text,
    reviewed_at timestamp without time zone,
    reject_reason text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.subcontractor_documents (
    id text NOT NULL,
    tenant_id text NOT NULL,
    subcontractor_id text NOT NULL,
    worker_id text,
    project_id text,
    requirement_id text NOT NULL,
    status public.subcontractor_doc_status NOT NULL,
    not_applicable_reason text,
    requested_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.subcontractor_workers (
    id text NOT NULL,
    tenant_id text NOT NULL,
    subcontractor_id text NOT NULL,
    first_name text NOT NULL,
    surnames text NOT NULL,
    id_document text NOT NULL,
    phone text,
    category text,
    trade text,
    ss_number text,
    contract_type text,
    start_date date,
    tpc_number text,
    roles jsonb DEFAULT '[]'::jsonb NOT NULL,
    ppe_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.subcontractors (
    id text NOT NULL,
    tenant_id text NOT NULL,
    kind public.subcontractor_kind NOT NULL,
    legal_name text NOT NULL,
    tax_id text NOT NULL,
    address text NOT NULL,
    postal_code text NOT NULL,
    city text NOT NULL,
    province text NOT NULL,
    rea_region text NOT NULL,
    rea_number text,
    phone text,
    email text,
    legal_rep text,
    site_contact text,
    site_contact_phone text,
    trades jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_installer boolean DEFAULT false NOT NULL,
    installer_reg text,
    headcount integer,
    permanent_count integer,
    subcontracts_further boolean DEFAULT false NOT NULL,
    chain_level integer DEFAULT 1 NOT NULL,
    prevention_mode public.prevention_mode,
    prevention_entity text,
    prevention_valid_until date,
    machinery jsonb DEFAULT '[]'::jsonb NOT NULL,
    supplies_only boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tenants (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    ai_monthly_limit_cents integer,
    letterhead jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.user_mfa (
    user_id text NOT NULL,
    tenant_id text NOT NULL,
    secret text NOT NULL,
    confirmed_at timestamp without time zone,
    recovery_codes jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_step integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.users (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text,
    email text NOT NULL,
    email_verified timestamp without time zone,
    image text,
    password_hash text,
    role public.user_role DEFAULT 'viewer'::public.user_role NOT NULL,
    active boolean DEFAULT true NOT NULL,
    language text,
    password_changed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.verification_tokens (
    identifier text NOT NULL,
    token text NOT NULL,
    expires timestamp without time zone NOT NULL
);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.budget_chapters
    ADD CONSTRAINT budget_chapters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.budget_chapters
    ADD CONSTRAINT budget_chapters_revision_code_unique UNIQUE (revision_id, code);

ALTER TABLE ONLY public.budget_generations
    ADD CONSTRAINT budget_generations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT budget_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.budget_revisions
    ADD CONSTRAINT budget_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.budget_revisions
    ADD CONSTRAINT budget_revisions_project_number_unique UNIQUE (project_id, number);

ALTER TABLE ONLY public.client_profiles
    ADD CONSTRAINT client_profiles_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.client_settings
    ADD CONSTRAINT client_settings_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pk PRIMARY KEY (tenant_id, scope, key);

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.obra_chapter_progress
    ADD CONSTRAINT obra_chapter_progress_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.obra_chapter_progress
    ADD CONSTRAINT obra_chapter_progress_project_chapter_unique UNIQUE (project_id, chapter_code);

ALTER TABLE ONLY public.obra_hito_chapters
    ADD CONSTRAINT obra_hito_chapters_hito_id_chapter_code_pk PRIMARY KEY (hito_id, chapter_code);

ALTER TABLE ONLY public.obra_hito_chapters
    ADD CONSTRAINT obra_hito_chapters_project_chapter_unique UNIQUE (project_id, chapter_code);

ALTER TABLE ONLY public.obra_hito_checks
    ADD CONSTRAINT obra_hito_checks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.obra_hito_events
    ADD CONSTRAINT obra_hito_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.obra_hito_photos
    ADD CONSTRAINT obra_hito_photos_hito_id_photo_id_pk PRIMARY KEY (hito_id, photo_id);

ALTER TABLE ONLY public.obra_hitos
    ADD CONSTRAINT obra_hitos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.obra_hitos
    ADD CONSTRAINT obra_hitos_project_code_unique UNIQUE (project_id, code);

ALTER TABLE ONLY public.obra_invoice_requests
    ADD CONSTRAINT obra_invoice_requests_hito_unique UNIQUE (hito_id);

ALTER TABLE ONLY public.obra_invoice_requests
    ADD CONSTRAINT obra_invoice_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.obra_issue_files
    ADD CONSTRAINT obra_issue_files_pathname_unique UNIQUE (pathname);

ALTER TABLE ONLY public.obra_issue_files
    ADD CONSTRAINT obra_issue_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.obra_issues
    ADD CONSTRAINT obra_issues_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.obra_issues
    ADD CONSTRAINT obra_issues_project_kind_number_unique UNIQUE (project_id, kind, number);

ALTER TABLE ONLY public.obra_progress_events
    ADD CONSTRAINT obra_progress_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.planning_items
    ADD CONSTRAINT planning_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.planning_items
    ADD CONSTRAINT planning_items_version_chapter_unique UNIQUE (version_id, chapter_code);

ALTER TABLE ONLY public.planning_versions
    ADD CONSTRAINT planning_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.planning_versions
    ADD CONSTRAINT planning_versions_project_number_unique UNIQUE (project_id, number);

ALTER TABLE ONLY public.project_documents
    ADD CONSTRAINT project_documents_pathname_unique UNIQUE (pathname);

ALTER TABLE ONLY public.project_documents
    ADD CONSTRAINT project_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_photos
    ADD CONSTRAINT project_photos_pathname_unique UNIQUE (pathname);

ALTER TABLE ONLY public.project_photos
    ADD CONSTRAINT project_photos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_document_checks
    ADD CONSTRAINT purchase_document_checks_invoice_file_unique UNIQUE (invoice_file_id);

ALTER TABLE ONLY public.purchase_document_checks
    ADD CONSTRAINT purchase_document_checks_payment_unique UNIQUE (payment_id);

ALTER TABLE ONLY public.purchase_document_checks
    ADD CONSTRAINT purchase_document_checks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_document_checks
    ADD CONSTRAINT purchase_document_checks_version_unique UNIQUE (document_version_id);

ALTER TABLE ONLY public.purchase_invoice_files
    ADD CONSTRAINT purchase_invoice_files_invoice_version_unique UNIQUE (invoice_id, version);

ALTER TABLE ONLY public.purchase_invoice_files
    ADD CONSTRAINT purchase_invoice_files_pathname_unique UNIQUE (pathname);

ALTER TABLE ONLY public.purchase_invoice_files
    ADD CONSTRAINT purchase_invoice_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_invoice_lines
    ADD CONSTRAINT purchase_invoice_lines_invoice_lineage_unique UNIQUE (invoice_id, lineage_id);

ALTER TABLE ONLY public.purchase_invoice_lines
    ADD CONSTRAINT purchase_invoice_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_order_amendments
    ADD CONSTRAINT purchase_order_amendments_order_number_unique UNIQUE (order_id, number);

ALTER TABLE ONLY public.purchase_order_amendments
    ADD CONSTRAINT purchase_order_amendments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_order_document_versions
    ADD CONSTRAINT purchase_order_document_versions_document_version_unique UNIQUE (document_id, version);

ALTER TABLE ONLY public.purchase_order_document_versions
    ADD CONSTRAINT purchase_order_document_versions_pathname_unique UNIQUE (pathname);

ALTER TABLE ONLY public.purchase_order_document_versions
    ADD CONSTRAINT purchase_order_document_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_order_documents
    ADD CONSTRAINT purchase_order_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_order_events
    ADD CONSTRAINT purchase_order_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_order_lineage_unique UNIQUE (order_id, lineage_id);

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_order_milestones
    ADD CONSTRAINT purchase_order_milestones_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_project_number_unique UNIQUE (project_id, number);

ALTER TABLE ONLY public.purchase_payments
    ADD CONSTRAINT purchase_payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_request_events
    ADD CONSTRAINT purchase_request_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_request_lines
    ADD CONSTRAINT purchase_request_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_request_lines
    ADD CONSTRAINT purchase_request_lines_request_lineage_unique UNIQUE (request_id, lineage_id);

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_project_number_unique UNIQUE (project_id, number);

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (token);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_session_token_unique UNIQUE (session_token);

ALTER TABLE ONLY public.subcontractor_assignments
    ADD CONSTRAINT subcontractor_assignments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subcontractor_assignments
    ADD CONSTRAINT subcontractor_assignments_subcontractor_project_unique UNIQUE (subcontractor_id, project_id);

ALTER TABLE ONLY public.subcontractor_audit
    ADD CONSTRAINT subcontractor_audit_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subcontractor_document_versions
    ADD CONSTRAINT subcontractor_document_versions_document_version_unique UNIQUE (document_id, version);

ALTER TABLE ONLY public.subcontractor_document_versions
    ADD CONSTRAINT subcontractor_document_versions_pathname_unique UNIQUE (pathname);

ALTER TABLE ONLY public.subcontractor_document_versions
    ADD CONSTRAINT subcontractor_document_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subcontractor_documents
    ADD CONSTRAINT subcontractor_documents_owner_requirement_unique UNIQUE NULLS NOT DISTINCT (subcontractor_id, worker_id, project_id, requirement_id);

ALTER TABLE ONLY public.subcontractor_documents
    ADD CONSTRAINT subcontractor_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subcontractor_workers
    ADD CONSTRAINT subcontractor_workers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subcontractor_workers
    ADD CONSTRAINT subcontractor_workers_tenant_id_document_unique UNIQUE (tenant_id, id_document);

ALTER TABLE ONLY public.subcontractors
    ADD CONSTRAINT subcontractors_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.subcontractors
    ADD CONSTRAINT subcontractors_tenant_tax_id_unique UNIQUE (tenant_id, tax_id);

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_unique UNIQUE (slug);

ALTER TABLE ONLY public.user_mfa
    ADD CONSTRAINT user_mfa_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_email_unique UNIQUE (tenant_id, email);

CREATE INDEX ai_usage_tenant_created_idx ON public.ai_usage USING btree (tenant_id, created_at);

CREATE INDEX budget_generations_project_idx ON public.budget_generations USING btree (project_id);

CREATE INDEX budget_lines_chapter_idx ON public.budget_lines USING btree (chapter_id);

CREATE INDEX idempotency_keys_created_idx ON public.idempotency_keys USING btree (created_at);

CREATE INDEX obra_hito_checks_hito_idx ON public.obra_hito_checks USING btree (hito_id);

CREATE INDEX obra_hito_events_hito_idx ON public.obra_hito_events USING btree (hito_id);

CREATE INDEX obra_hito_events_tenant_idx ON public.obra_hito_events USING btree (tenant_id);

CREATE INDEX obra_issue_files_issue_idx ON public.obra_issue_files USING btree (issue_id);

CREATE INDEX obra_progress_events_project_idx ON public.obra_progress_events USING btree (project_id, recorded_at);

CREATE UNIQUE INDEX planning_versions_one_approved ON public.planning_versions USING btree (project_id) WHERE (status = 'approved'::text);

CREATE UNIQUE INDEX planning_versions_one_draft ON public.planning_versions USING btree (project_id) WHERE (status = 'draft'::text);

CREATE INDEX project_documents_project_idx ON public.project_documents USING btree (project_id);

CREATE INDEX project_photos_project_idx ON public.project_photos USING btree (project_id);

CREATE INDEX projects_client_user_idx ON public.projects USING btree (client_user_id);

CREATE UNIQUE INDEX projects_tenant_ref_unique ON public.projects USING btree (tenant_id, ref) WHERE (deleted_at IS NULL);

CREATE INDEX purchase_document_checks_order_idx ON public.purchase_document_checks USING btree (order_id);

CREATE INDEX purchase_document_checks_tenant_sha_idx ON public.purchase_document_checks USING btree (tenant_id, sha256);

CREATE INDEX purchase_document_checks_tenant_status_idx ON public.purchase_document_checks USING btree (tenant_id, status);

CREATE INDEX purchase_invoice_files_tenant_created_idx ON public.purchase_invoice_files USING btree (tenant_id, created_at);

CREATE INDEX purchase_invoices_order_idx ON public.purchase_invoices USING btree (order_id);

CREATE INDEX purchase_invoices_rectifies_idx ON public.purchase_invoices USING btree (rectifies_id);

CREATE UNIQUE INDEX purchase_invoices_supplier_number_unique ON public.purchase_invoices USING btree (tenant_id, subcontractor_id, number) WHERE (deleted_at IS NULL);

CREATE INDEX purchase_invoices_tenant_due_idx ON public.purchase_invoices USING btree (tenant_id, due_on);

CREATE INDEX purchase_order_document_versions_tenant_created_idx ON public.purchase_order_document_versions USING btree (tenant_id, created_at);

CREATE INDEX purchase_order_documents_order_idx ON public.purchase_order_documents USING btree (order_id);

CREATE INDEX purchase_order_events_order_created_idx ON public.purchase_order_events USING btree (order_id, created_at);

CREATE INDEX purchase_order_milestones_order_idx ON public.purchase_order_milestones USING btree (order_id);

CREATE INDEX purchase_orders_subcontractor_idx ON public.purchase_orders USING btree (subcontractor_id);

CREATE INDEX purchase_orders_tenant_idx ON public.purchase_orders USING btree (tenant_id);

CREATE INDEX purchase_payments_invoice_idx ON public.purchase_payments USING btree (invoice_id);

CREATE INDEX purchase_payments_tenant_created_idx ON public.purchase_payments USING btree (tenant_id, created_at);

CREATE INDEX purchase_payments_tenant_paid_idx ON public.purchase_payments USING btree (tenant_id, paid_on);

CREATE INDEX purchase_request_events_request_created_idx ON public.purchase_request_events USING btree (request_id, created_at);

CREATE UNIQUE INDEX purchase_requests_order_unique ON public.purchase_requests USING btree (order_id) WHERE (order_id IS NOT NULL);

CREATE INDEX purchase_requests_tenant_status_idx ON public.purchase_requests USING btree (tenant_id, status);

CREATE INDEX push_tokens_user_idx ON public.push_tokens USING btree (user_id);

CREATE INDEX subcontractor_assignments_tenant_idx ON public.subcontractor_assignments USING btree (tenant_id);

CREATE INDEX subcontractor_audit_subcontractor_created_idx ON public.subcontractor_audit USING btree (subcontractor_id, created_at);

CREATE INDEX subcontractor_document_versions_tenant_document_idx ON public.subcontractor_document_versions USING btree (tenant_id, document_id, version);

CREATE INDEX subcontractor_documents_tenant_idx ON public.subcontractor_documents USING btree (tenant_id);

CREATE INDEX subcontractor_workers_subcontractor_idx ON public.subcontractor_workers USING btree (subcontractor_id);

CREATE INDEX subcontractor_workers_tenant_tpc_idx ON public.subcontractor_workers USING btree (tenant_id, tpc_number);

CREATE UNIQUE INDEX users_client_email_unique ON public.users USING btree (email) WHERE (role = 'client'::public.user_role);

CREATE UNIQUE INDEX users_staff_email_unique ON public.users USING btree (lower(email)) WHERE (role <> 'client'::public.user_role);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_generation_id_budget_generations_id_fk FOREIGN KEY (generation_id) REFERENCES public.budget_generations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.budget_chapters
    ADD CONSTRAINT budget_chapters_revision_id_budget_revisions_id_fk FOREIGN KEY (revision_id) REFERENCES public.budget_revisions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.budget_chapters
    ADD CONSTRAINT budget_chapters_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.budget_generations
    ADD CONSTRAINT budget_generations_created_by_id_users_id_fk FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.budget_generations
    ADD CONSTRAINT budget_generations_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.budget_generations
    ADD CONSTRAINT budget_generations_revision_id_budget_revisions_id_fk FOREIGN KEY (revision_id) REFERENCES public.budget_revisions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.budget_generations
    ADD CONSTRAINT budget_generations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT budget_lines_chapter_id_budget_chapters_id_fk FOREIGN KEY (chapter_id) REFERENCES public.budget_chapters(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT budget_lines_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.budget_revisions
    ADD CONSTRAINT budget_revisions_accepted_by_user_id_users_id_fk FOREIGN KEY (accepted_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.budget_revisions
    ADD CONSTRAINT budget_revisions_accepted_document_id_project_documents_id_fk FOREIGN KEY (accepted_document_id) REFERENCES public.project_documents(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.budget_revisions
    ADD CONSTRAINT budget_revisions_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.budget_revisions
    ADD CONSTRAINT budget_revisions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.client_profiles
    ADD CONSTRAINT client_profiles_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.client_profiles
    ADD CONSTRAINT client_profiles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.client_settings
    ADD CONSTRAINT client_settings_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.client_settings
    ADD CONSTRAINT client_settings_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.obra_chapter_progress
    ADD CONSTRAINT obra_chapter_progress_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_chapter_progress
    ADD CONSTRAINT obra_chapter_progress_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hito_chapters
    ADD CONSTRAINT obra_hito_chapters_hito_id_obra_hitos_id_fk FOREIGN KEY (hito_id) REFERENCES public.obra_hitos(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hito_chapters
    ADD CONSTRAINT obra_hito_chapters_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hito_chapters
    ADD CONSTRAINT obra_hito_chapters_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hito_checks
    ADD CONSTRAINT obra_hito_checks_hito_id_obra_hitos_id_fk FOREIGN KEY (hito_id) REFERENCES public.obra_hitos(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hito_checks
    ADD CONSTRAINT obra_hito_checks_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hito_events
    ADD CONSTRAINT obra_hito_events_hito_id_obra_hitos_id_fk FOREIGN KEY (hito_id) REFERENCES public.obra_hitos(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hito_events
    ADD CONSTRAINT obra_hito_events_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hito_events
    ADD CONSTRAINT obra_hito_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hito_events
    ADD CONSTRAINT obra_hito_events_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.obra_hito_photos
    ADD CONSTRAINT obra_hito_photos_hito_id_obra_hitos_id_fk FOREIGN KEY (hito_id) REFERENCES public.obra_hitos(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hito_photos
    ADD CONSTRAINT obra_hito_photos_photo_id_project_photos_id_fk FOREIGN KEY (photo_id) REFERENCES public.project_photos(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hito_photos
    ADD CONSTRAINT obra_hito_photos_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hitos
    ADD CONSTRAINT obra_hitos_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_hitos
    ADD CONSTRAINT obra_hitos_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_invoice_requests
    ADD CONSTRAINT obra_invoice_requests_hito_id_obra_hitos_id_fk FOREIGN KEY (hito_id) REFERENCES public.obra_hitos(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_invoice_requests
    ADD CONSTRAINT obra_invoice_requests_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_invoice_requests
    ADD CONSTRAINT obra_invoice_requests_requested_by_id_users_id_fk FOREIGN KEY (requested_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.obra_invoice_requests
    ADD CONSTRAINT obra_invoice_requests_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_issue_files
    ADD CONSTRAINT obra_issue_files_deleted_by_id_users_id_fk FOREIGN KEY (deleted_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.obra_issue_files
    ADD CONSTRAINT obra_issue_files_issue_id_obra_issues_id_fk FOREIGN KEY (issue_id) REFERENCES public.obra_issues(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_issue_files
    ADD CONSTRAINT obra_issue_files_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_issue_files
    ADD CONSTRAINT obra_issue_files_uploaded_by_id_users_id_fk FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.obra_issues
    ADD CONSTRAINT obra_issues_created_by_id_users_id_fk FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.obra_issues
    ADD CONSTRAINT obra_issues_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_issues
    ADD CONSTRAINT obra_issues_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_progress_events
    ADD CONSTRAINT obra_progress_events_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.obra_progress_events
    ADD CONSTRAINT obra_progress_events_recorded_by_id_users_id_fk FOREIGN KEY (recorded_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.obra_progress_events
    ADD CONSTRAINT obra_progress_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.planning_items
    ADD CONSTRAINT planning_items_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.planning_items
    ADD CONSTRAINT planning_items_version_id_planning_versions_id_fk FOREIGN KEY (version_id) REFERENCES public.planning_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.planning_versions
    ADD CONSTRAINT planning_versions_approved_by_id_users_id_fk FOREIGN KEY (approved_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.planning_versions
    ADD CONSTRAINT planning_versions_created_by_id_users_id_fk FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.planning_versions
    ADD CONSTRAINT planning_versions_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.planning_versions
    ADD CONSTRAINT planning_versions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_documents
    ADD CONSTRAINT project_documents_budget_revision_id_budget_revisions_id_fk FOREIGN KEY (budget_revision_id) REFERENCES public.budget_revisions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.project_documents
    ADD CONSTRAINT project_documents_deleted_by_id_users_id_fk FOREIGN KEY (deleted_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.project_documents
    ADD CONSTRAINT project_documents_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_documents
    ADD CONSTRAINT project_documents_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_documents
    ADD CONSTRAINT project_documents_uploaded_by_id_users_id_fk FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.project_photos
    ADD CONSTRAINT project_photos_deleted_by_id_users_id_fk FOREIGN KEY (deleted_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.project_photos
    ADD CONSTRAINT project_photos_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_photos
    ADD CONSTRAINT project_photos_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_photos
    ADD CONSTRAINT project_photos_uploaded_by_id_users_id_fk FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_client_user_id_users_id_fk FOREIGN KEY (client_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_deleted_by_id_users_id_fk FOREIGN KEY (deleted_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_document_checks
    ADD CONSTRAINT purchase_document_checks_dismissed_by_id_users_id_fk FOREIGN KEY (dismissed_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_document_checks
    ADD CONSTRAINT purchase_document_checks_document_version_id_purchase_order_doc FOREIGN KEY (document_version_id) REFERENCES public.purchase_order_document_versions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_document_checks
    ADD CONSTRAINT purchase_document_checks_invoice_file_id_purchase_invoice_files FOREIGN KEY (invoice_file_id) REFERENCES public.purchase_invoice_files(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_document_checks
    ADD CONSTRAINT purchase_document_checks_order_id_purchase_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_document_checks
    ADD CONSTRAINT purchase_document_checks_payment_id_purchase_payments_id_fk FOREIGN KEY (payment_id) REFERENCES public.purchase_payments(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_document_checks
    ADD CONSTRAINT purchase_document_checks_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_invoice_files
    ADD CONSTRAINT purchase_invoice_files_invoice_id_purchase_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.purchase_invoices(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_invoice_files
    ADD CONSTRAINT purchase_invoice_files_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_invoice_files
    ADD CONSTRAINT purchase_invoice_files_uploaded_by_id_users_id_fk FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_invoice_lines
    ADD CONSTRAINT purchase_invoice_lines_invoice_id_purchase_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.purchase_invoices(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_invoice_lines
    ADD CONSTRAINT purchase_invoice_lines_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_created_by_id_users_id_fk FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_deleted_by_id_users_id_fk FOREIGN KEY (deleted_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_milestone_id_purchase_order_milestones_id_fk FOREIGN KEY (milestone_id) REFERENCES public.purchase_order_milestones(id);

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_order_id_purchase_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_rectifies_id_purchase_invoices_id_fk FOREIGN KEY (rectifies_id) REFERENCES public.purchase_invoices(id);

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_subcontractor_id_subcontractors_id_fk FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id);

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_order_amendments
    ADD CONSTRAINT purchase_order_amendments_created_by_id_users_id_fk FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_order_amendments
    ADD CONSTRAINT purchase_order_amendments_document_id_purchase_order_documents_ FOREIGN KEY (document_id) REFERENCES public.purchase_order_documents(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_order_amendments
    ADD CONSTRAINT purchase_order_amendments_order_id_purchase_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_order_amendments
    ADD CONSTRAINT purchase_order_amendments_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_order_document_versions
    ADD CONSTRAINT purchase_order_document_versions_document_id_purchase_order_doc FOREIGN KEY (document_id) REFERENCES public.purchase_order_documents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_order_document_versions
    ADD CONSTRAINT purchase_order_document_versions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_order_document_versions
    ADD CONSTRAINT purchase_order_document_versions_uploaded_by_id_users_id_fk FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_order_documents
    ADD CONSTRAINT purchase_order_documents_created_by_id_users_id_fk FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_order_documents
    ADD CONSTRAINT purchase_order_documents_deleted_by_id_users_id_fk FOREIGN KEY (deleted_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_order_documents
    ADD CONSTRAINT purchase_order_documents_order_id_purchase_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_order_documents
    ADD CONSTRAINT purchase_order_documents_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_order_events
    ADD CONSTRAINT purchase_order_events_order_id_purchase_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_order_events
    ADD CONSTRAINT purchase_order_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_order_events
    ADD CONSTRAINT purchase_order_events_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_order_id_purchase_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_order_milestones
    ADD CONSTRAINT purchase_order_milestones_order_id_purchase_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_order_milestones
    ADD CONSTRAINT purchase_order_milestones_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_created_by_id_users_id_fk FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_subcontractor_id_subcontractors_id_fk FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id);

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_payments
    ADD CONSTRAINT purchase_payments_created_by_id_users_id_fk FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_payments
    ADD CONSTRAINT purchase_payments_deleted_by_id_users_id_fk FOREIGN KEY (deleted_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_payments
    ADD CONSTRAINT purchase_payments_invoice_id_purchase_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.purchase_invoices(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_payments
    ADD CONSTRAINT purchase_payments_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_request_events
    ADD CONSTRAINT purchase_request_events_request_id_purchase_requests_id_fk FOREIGN KEY (request_id) REFERENCES public.purchase_requests(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_request_events
    ADD CONSTRAINT purchase_request_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_request_events
    ADD CONSTRAINT purchase_request_events_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_request_lines
    ADD CONSTRAINT purchase_request_lines_request_id_purchase_requests_id_fk FOREIGN KEY (request_id) REFERENCES public.purchase_requests(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_request_lines
    ADD CONSTRAINT purchase_request_lines_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_created_by_id_users_id_fk FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_decided_by_id_users_id_fk FOREIGN KEY (decided_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_order_id_purchase_orders_id_fk FOREIGN KEY (order_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_subcontractor_id_subcontractors_id_fk FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_assignments
    ADD CONSTRAINT subcontractor_assignments_deleted_by_id_users_id_fk FOREIGN KEY (deleted_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.subcontractor_assignments
    ADD CONSTRAINT subcontractor_assignments_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_assignments
    ADD CONSTRAINT subcontractor_assignments_subcontractor_id_subcontractors_id_fk FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_assignments
    ADD CONSTRAINT subcontractor_assignments_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_audit
    ADD CONSTRAINT subcontractor_audit_subcontractor_id_subcontractors_id_fk FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_audit
    ADD CONSTRAINT subcontractor_audit_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_audit
    ADD CONSTRAINT subcontractor_audit_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.subcontractor_audit
    ADD CONSTRAINT subcontractor_audit_worker_id_subcontractor_workers_id_fk FOREIGN KEY (worker_id) REFERENCES public.subcontractor_workers(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.subcontractor_document_versions
    ADD CONSTRAINT subcontractor_document_versions_document_id_subcontractor_docum FOREIGN KEY (document_id) REFERENCES public.subcontractor_documents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_document_versions
    ADD CONSTRAINT subcontractor_document_versions_reviewed_by_id_users_id_fk FOREIGN KEY (reviewed_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.subcontractor_document_versions
    ADD CONSTRAINT subcontractor_document_versions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_document_versions
    ADD CONSTRAINT subcontractor_document_versions_uploaded_by_id_users_id_fk FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.subcontractor_documents
    ADD CONSTRAINT subcontractor_documents_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_documents
    ADD CONSTRAINT subcontractor_documents_subcontractor_id_subcontractors_id_fk FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_documents
    ADD CONSTRAINT subcontractor_documents_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_documents
    ADD CONSTRAINT subcontractor_documents_worker_id_subcontractor_workers_id_fk FOREIGN KEY (worker_id) REFERENCES public.subcontractor_workers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_workers
    ADD CONSTRAINT subcontractor_workers_subcontractor_id_subcontractors_id_fk FOREIGN KEY (subcontractor_id) REFERENCES public.subcontractors(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractor_workers
    ADD CONSTRAINT subcontractor_workers_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subcontractors
    ADD CONSTRAINT subcontractors_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_mfa
    ADD CONSTRAINT user_mfa_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_mfa
    ADD CONSTRAINT user_mfa_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

