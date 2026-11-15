-- Garantía: the warranty claims a handed-over home's client sends from the app
-- (packages/core/src/warranty.ts): the claim (numbered per project, GAR-001),
-- its photos (private Blob store) and its history (append-only). Additive: three
-- new tables, read only by the new code; the previous deployment never touches
-- them. Safe to run twice.

-- The foreign keys lock tenants, projects and users briefly: never queue the portal behind this file.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "warranty_claims" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "project_id" text NOT NULL,
  "number" integer NOT NULL,
  "kind" text NOT NULL,
  "room" text NOT NULL,
  "description" text NOT NULL,
  "urgent" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'received' NOT NULL,
  "visit_on" date,
  "answer" text,
  "answered_at" timestamp,
  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "warranty_claims_project_number_unique" UNIQUE ("project_id", "number"),
  CONSTRAINT "warranty_claims_id_tenant_id_unique" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "warranty_claims_project_id_tenant_fk" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "projects"("tenant_id", "id"),
  CONSTRAINT "warranty_claims_kind_check" CHECK (kind IN ('finishes', 'plumbing', 'electrical', 'carpentry', 'damp', 'other')),
  CONSTRAINT "warranty_claims_room_check" CHECK (room IN ('bathroom', 'kitchen', 'living_room', 'bedroom', 'hall', 'exterior', 'other')),
  CONSTRAINT "warranty_claims_status_check" CHECK (status IN ('received', 'in_review', 'scheduled', 'resolved', 'rejected', 'cancelled')),
  CONSTRAINT "warranty_claims_number_check" CHECK (number >= 1),
  CONSTRAINT "warranty_claims_scheduled_check" CHECK (status <> 'scheduled' OR visit_on IS NOT NULL),
  CONSTRAINT "warranty_claims_rejected_check" CHECK (status <> 'rejected' OR answer IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS "warranty_claims_project_created_idx" ON "warranty_claims" ("project_id", "created_at");

CREATE TABLE IF NOT EXISTS "warranty_claim_photos" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "claim_id" text NOT NULL,
  "pathname" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "thumb_size_bytes" integer NOT NULL,
  "uploaded_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "warranty_claim_photos_pathname_unique" UNIQUE ("pathname"),
  CONSTRAINT "warranty_claim_photos_claim_id_tenant_fk" FOREIGN KEY ("tenant_id", "claim_id")
    REFERENCES "warranty_claims"("tenant_id", "id") ON DELETE cascade,
  CONSTRAINT "warranty_claim_photos_size_bytes_check" CHECK (size_bytes >= 0),
  CONSTRAINT "warranty_claim_photos_thumb_size_bytes_check" CHECK (thumb_size_bytes >= 0)
);
CREATE INDEX IF NOT EXISTS "warranty_claim_photos_claim_idx" ON "warranty_claim_photos" ("claim_id");

CREATE TABLE IF NOT EXISTS "warranty_claim_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "claim_id" text NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "action" text NOT NULL,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "warranty_claim_events_claim_id_tenant_fk" FOREIGN KEY ("tenant_id", "claim_id")
    REFERENCES "warranty_claims"("tenant_id", "id") ON DELETE cascade,
  CONSTRAINT "warranty_claim_events_action_check" CHECK (action IN ('created', 'photo_added', 'updated', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS "warranty_claim_events_claim_created_idx" ON "warranty_claim_events" ("claim_id", "created_at");
