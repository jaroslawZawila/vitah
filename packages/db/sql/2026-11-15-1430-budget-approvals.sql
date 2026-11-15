-- Changes to the contract and the client's consent in the app (packages/core/src/budget-approvals.ts):
-- the changes (CAM-) a budget revision prices, the requests to the client to approve an issued revision
-- and their answer, and the approval the acceptance names as its proof.
--
-- Additive: two new tables and one nullable column on budget_revisions (with its key: every row is null,
-- so validating it checks nothing). The previous deployment never reads them; this one reads the column
-- with every revision, so apply the file BEFORE the code goes live (Drizzle names every column it selects).

-- Never queue the portal behind this file: if a lock is not free in 5 s it fails, whole, and is run again.
SET LOCAL lock_timeout = '5s';

-- The strongest lock first, while this file holds no other: issuing a revision locks its row, then inserts
-- the PDFs into project_documents; taken after the tables below (whose keys lock project_documents and
-- budget_revisions against writes), ACCESS EXCLUSIVE on budget_revisions would wait on such an issue
-- while it waited on this file: a deadlock, one of the two aborted.
ALTER TABLE "budget_revisions" ADD COLUMN IF NOT EXISTS "accepted_approval_id" text;

CREATE TABLE IF NOT EXISTS "budget_revision_changes" (
  "tenant_id" text NOT NULL,
  "revision_id" text NOT NULL,
  "issue_id" text NOT NULL,
  "linked_by_id" text,
  "linked_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "budget_revision_changes_pk" PRIMARY KEY ("revision_id", "issue_id"),
  CONSTRAINT "budget_revision_changes_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "budget_revision_changes_linked_by_id_users_id_fk"
    FOREIGN KEY ("linked_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "budget_revision_changes_revision_id_tenant_fk"
    FOREIGN KEY ("tenant_id", "revision_id") REFERENCES "budget_revisions"("tenant_id", "id") ON DELETE CASCADE,
  CONSTRAINT "budget_revision_changes_issue_id_tenant_fk"
    FOREIGN KEY ("tenant_id", "issue_id") REFERENCES "obra_issues"("tenant_id", "id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "budget_revision_changes_issue_idx" ON "budget_revision_changes" ("issue_id");

CREATE TABLE IF NOT EXISTS "budget_approvals" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "project_id" text NOT NULL,
  "revision_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "client_user_id" text,
  "message" text,
  "chosen_option_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "document_id" text,
  "before_cents" integer NOT NULL,
  "after_cents" integer NOT NULL,
  "vat_rate_bp" integer NOT NULL,
  "asked_by_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "decided_by_id" text,
  "decided_at" timestamp,
  "reject_reason" text,
  "closed_by_id" text,
  "closed_at" timestamp,
  CONSTRAINT "budget_approvals_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "budget_approvals_project_id_tenant_fk"
    FOREIGN KEY ("tenant_id", "project_id") REFERENCES "projects"("tenant_id", "id"),
  CONSTRAINT "budget_approvals_revision_id_tenant_fk"
    FOREIGN KEY ("tenant_id", "revision_id") REFERENCES "budget_revisions"("tenant_id", "id"),
  CONSTRAINT "budget_approvals_client_user_id_users_id_fk"
    FOREIGN KEY ("client_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "budget_approvals_document_id_project_documents_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "project_documents"("id") ON DELETE SET NULL,
  CONSTRAINT "budget_approvals_asked_by_id_users_id_fk"
    FOREIGN KEY ("asked_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "budget_approvals_decided_by_id_users_id_fk"
    FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "budget_approvals_closed_by_id_users_id_fk"
    FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "budget_approvals_status_check"
    CHECK ("status" in ('pending', 'approved', 'rejected', 'withdrawn', 'lapsed')),
  CONSTRAINT "budget_approvals_vat_rate_bp_check" CHECK ("vat_rate_bp" between 0 and 10000),
  CONSTRAINT "budget_approvals_decided_check" CHECK (
    ("decided_at" is not null) = ("status" in ('approved', 'rejected'))
      and ("reject_reason" is not null) = ("status" = 'rejected')
      and ("closed_at" is not null) = ("status" in ('withdrawn', 'lapsed'))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "budget_approvals_one_open" ON "budget_approvals" ("revision_id") WHERE "status" = 'pending';
CREATE INDEX IF NOT EXISTS "budget_approvals_project_idx" ON "budget_approvals" ("project_id");

-- A key on a table with rows: added NOT VALID and validated on its own, as every one (the column is new
-- and empty, so validating it checks nothing).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'budget_revisions_accepted_approval_id_budget_approvals_id_fk'
      AND conrelid = 'budget_revisions'::regclass
  ) THEN
    ALTER TABLE "budget_revisions"
      ADD CONSTRAINT "budget_revisions_accepted_approval_id_budget_approvals_id_fk"
      FOREIGN KEY ("accepted_approval_id") REFERENCES "budget_approvals"("id") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
ALTER TABLE "budget_revisions" VALIDATE CONSTRAINT "budget_revisions_accepted_approval_id_budget_approvals_id_fk";
