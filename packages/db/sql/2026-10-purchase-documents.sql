-- Prod migration: several documents per order, each in versions (Compras).
-- Additive only; safe to re-run. Each order's single PDF so far
-- (purchase_orders.file_*) becomes its first document, version 1, pointing
-- at the same stored file; the ids are derived from the order's, so a second
-- run inserts nothing new and only refreshes version 1 to the order's current
-- file (if the old code replaced it before the new code was live).

CREATE TABLE IF NOT EXISTS "purchase_order_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "order_id" text NOT NULL REFERENCES "purchase_orders"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "created_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "purchase_order_documents_order_idx" ON "purchase_order_documents" ("order_id");

CREATE TABLE IF NOT EXISTS "purchase_order_document_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "document_id" text NOT NULL REFERENCES "purchase_order_documents"("id") ON DELETE cascade,
  "version" integer NOT NULL,
  "pathname" text NOT NULL,
  "filename" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "note" text,
  "uploaded_by_id" text REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_order_document_versions_pathname_unique" UNIQUE ("pathname"),
  CONSTRAINT "purchase_order_document_versions_document_version_unique" UNIQUE ("document_id", "version")
);

INSERT INTO "purchase_order_documents" ("id", "tenant_id", "order_id", "title", "created_by_id", "created_at")
SELECT 'legacy-' || o."id", o."tenant_id", o."id",
       coalesce(nullif(regexp_replace(coalesce(o."file_name", ''), '\.pdf$', '', 'i'), ''), 'pedido'),
       o."created_by_id", o."updated_at"
FROM "purchase_orders" o
WHERE o."file_pathname" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "purchase_order_document_versions"
  ("id", "tenant_id", "document_id", "version", "pathname", "filename", "size_bytes", "uploaded_by_id", "created_at")
SELECT 'legacy-' || o."id", o."tenant_id", 'legacy-' || o."id", 1, o."file_pathname",
       coalesce(o."file_name", 'pedido.pdf'), coalesce(o."file_size_bytes", 0), o."created_by_id", o."updated_at"
FROM "purchase_orders" o
WHERE o."file_pathname" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "purchase_order_documents" d WHERE d."id" = 'legacy-' || o."id")
ON CONFLICT ("id") DO UPDATE
  SET "pathname" = excluded."pathname", "filename" = excluded."filename", "size_bytes" = excluded."size_bytes";
