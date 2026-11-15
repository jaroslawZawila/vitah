// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { COLUMN_RANGES, COLUMN_VALUES, deletedTogether, inOrder, notNegative, oneOf, within } from "./checks";
import { tenants } from "./tenants";
import { underProject } from "./under-project";
import { users } from "./users";

// --- Subcontractors (Subcontratas) ---

// Companies and self-employed workers who work on the tenant's obras, with the
// documents the coordination of business activities asks of them (CAE:
// RD 171/2004, Ley 32/2006). Their status and their workers' site access are
// computed from the documents (packages/core/src/subcontractor-rules.ts), never
// stored. Staff only: the client never sees any of it.

export const subcontractorKindEnum = pgEnum("subcontractor_kind", ["company", "self_employed"]);

export const preventionModeEnum = pgEnum("prevention_mode", [
  "external_service",
  "own_service",
  "joint_service",
  "employer",
]);

// "Required" (nothing yet) has no row; "expired" is computed from the version's date.
export const subcontractorDocStatusEnum = pgEnum("subcontractor_doc_status", [
  "requested",
  "uploaded",
  "validated",
  "rejected",
  "not_applicable",
]);

export const subcontractors = pgTable(
  "subcontractors",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: subcontractorKindEnum("kind").notNull(),
    legalName: text("legal_name").notNull(),
    // CIF (company) or NIF (self-employed), upper case without separators.
    taxId: text("tax_id").notNull(),
    address: text("address").notNull(),
    postalCode: text("postal_code").notNull(),
    city: text("city").notNull(),
    province: text("province").notNull(),
    // The autonomous community whose REA the company is registered in (from its registered office).
    reaRegion: text("rea_region").notNull(),
    reaNumber: text("rea_number"),
    phone: text("phone"),
    email: text("email"),
    legalRep: text("legal_rep"),
    siteContact: text("site_contact"),
    siteContactPhone: text("site_contact_phone"),
    trades: jsonb("trades").$type<string[]>().default([]).notNull(),
    isInstaller: boolean("is_installer").default(false).notNull(),
    installerReg: text("installer_reg"),
    headcount: integer("headcount"),
    permanentCount: integer("permanent_count"),
    subcontractsFurther: boolean("subcontracts_further").default(false).notNull(),
    // Its level in the subcontracting chain (1 = hired by the contractor); at most 3.
    chainLevel: integer("chain_level").default(1).notNull(),
    preventionMode: preventionModeEnum("prevention_mode"),
    preventionEntity: text("prevention_entity"),
    preventionValidUntil: date("prevention_valid_until", { mode: "string" }),
    machinery: jsonb("machinery").$type<string[]>().default([]).notNull(),
    // A material supplier: it only delivers, so no CAE documents, workers or obra assignments.
    suppliesOnly: boolean("supplies_only").default(false).notNull(),
    // Its CAE status (apta | pendiente | bloqueada) as the rules last worked it out, and the last day that holds
    // (9999-12-31: no date will change it). Derived: written by every write it depends on; null = never worked out.
    caeStatus: text("cae_status").$type<(typeof COLUMN_VALUES.caeStatus)[number]>(),
    caeValidUntil: date("cae_valid_until", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    tenantTaxIdUnique: unique("subcontractors_tenant_tax_id_unique").on(table.tenantId, table.taxId),
    tenantIdUnique: unique("subcontractors_id_tenant_id_unique").on(table.id, table.tenantId),
    // Ley 32/2006 art. 5: three levels of subcontracting at most.
    chainLevelCheck: within("subcontractors_chain_level_check", table.chainLevel, COLUMN_RANGES.chainLevel),
    headcountCheck: check(
      "subcontractors_headcount_check",
      sql`${table.headcount} >= 0 and ${table.permanentCount} >= 0 and ${table.permanentCount} <= ${table.headcount}`,
    ),
    caeStatusCheck: oneOf("subcontractors_cae_status_check", table.caeStatus, COLUMN_VALUES.caeStatus),
  }),
);

export const subcontractorWorkers = pgTable(
  "subcontractor_workers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subcontractorId: text("subcontractor_id").notNull(),
    firstName: text("first_name").notNull(),
    surnames: text("surnames").notNull(),
    // DNI or NIE, upper case without separators.
    idDocument: text("id_document").notNull(),
    phone: text("phone"),
    category: text("category"),
    // Trade per the collective agreement: decides the 20 h trade training it needs.
    trade: text("trade"),
    ssNumber: text("ss_number"),
    contractType: text("contract_type"),
    startDate: date("start_date", { mode: "string" }),
    tpcNumber: text("tpc_number"),
    // preventive_resource | machine_operator
    roles: jsonb("roles").$type<string[]>().default([]).notNull(),
    // The PPE handed over (casco, calzado S3…); the signed receipt is a document.
    ppeItems: jsonb("ppe_items").$type<string[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    tenantIdDocumentUnique: unique("subcontractor_workers_tenant_id_document_unique").on(
      table.tenantId,
      table.idDocument,
    ),
    subcontractorIdx: index("subcontractor_workers_subcontractor_idx").on(table.subcontractorId),
    // "Comprobar acceso" looks workers up by TPC number too.
    tenantTpcIdx: index("subcontractor_workers_tenant_tpc_idx").on(table.tenantId, table.tpcNumber),
    tenantIdUnique: unique("subcontractor_workers_id_tenant_id_unique").on(table.id, table.tenantId),
    subcontractorFk: foreignKey({
      name: "subcontractor_workers_subcontractor_id_tenant_fk",
      columns: [table.tenantId, table.subcontractorId],
      foreignColumns: [subcontractors.tenantId, subcontractors.id],
    }).onDelete("cascade"),
  }),
);

// One required document of a company, of one of its workers, or of the company
// on one obra (`requirementId` from SUBCONTRACTOR_REQUIREMENTS). Its files are
// the versions below; a new upload never replaces an older one.
export const subcontractorDocuments = pgTable(
  "subcontractor_documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subcontractorId: text("subcontractor_id").notNull(),
    workerId: text("worker_id"),
    projectId: text("project_id"),
    requirementId: text("requirement_id").notNull(),
    status: subcontractorDocStatusEnum("status").notNull(),
    notApplicableReason: text("not_applicable_reason"),
    requestedAt: timestamp("requested_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    ownerRequirementUnique: unique("subcontractor_documents_owner_requirement_unique")
      .on(table.subcontractorId, table.workerId, table.projectId, table.requirementId)
      .nullsNotDistinct(),
    tenantIdx: index("subcontractor_documents_tenant_idx").on(table.tenantId),
    tenantIdUnique: unique("subcontractor_documents_id_tenant_id_unique").on(table.id, table.tenantId),
    subcontractorFk: foreignKey({
      name: "subcontractor_documents_subcontractor_id_tenant_fk",
      columns: [table.tenantId, table.subcontractorId],
      foreignColumns: [subcontractors.tenantId, subcontractors.id],
    }).onDelete("cascade"),
    workerFk: foreignKey({
      name: "subcontractor_documents_worker_id_tenant_fk",
      columns: [table.tenantId, table.workerId],
      foreignColumns: [subcontractorWorkers.tenantId, subcontractorWorkers.id],
    }).onDelete("cascade"),
    projectFk: underProject("subcontractor_documents_project_id_tenant_fk", table),
  }),
);

// An uploaded file of a document: immutable once stored. Its review (validated
// or rejected, by whom) is recorded on it.
export const subcontractorDocumentVersions = pgTable(
  "subcontractor_document_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull(),
    version: integer("version").notNull(),
    pathname: text("pathname").unique().notNull(),
    filename: text("filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    issuedAt: date("issued_at", { mode: "string" }),
    expiresAt: date("expires_at", { mode: "string" }),
    uploadedById: text("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    reviewedById: text("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { mode: "date" }),
    rejectReason: text("reject_reason"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    documentVersionUnique: unique("subcontractor_document_versions_document_version_unique").on(
      table.documentId,
      table.version,
    ),
    // Each document's current version across a tenant (DISTINCT ON document_id … version DESC).
    tenantDocumentVersionIdx: index("subcontractor_document_versions_tenant_document_idx").on(
      table.tenantId,
      table.documentId,
      table.version,
    ),
    documentFk: foreignKey({
      name: "subcontractor_document_versions_document_id_tenant_fk",
      columns: [table.tenantId, table.documentId],
      foreignColumns: [subcontractorDocuments.tenantId, subcontractorDocuments.id],
    }).onDelete("cascade"),
    versionCheck: check(
      "subcontractor_document_versions_version_check",
      sql`${table.version} >= 1 and ${table.sizeBytes} >= 0`,
    ),
  }),
);

// A company working on an obra: the budget chapters it executes, its planned
// dates and its entry in the obra's Libro de Subcontratación (Ley 32/2006 art. 8).
export const subcontractorAssignments = pgTable(
  "subcontractor_assignments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subcontractorId: text("subcontractor_id").notNull(),
    projectId: text("project_id").notNull(),
    chapterCodes: jsonb("chapter_codes").$type<string[]>().default([]).notNull(),
    plannedStart: date("planned_start", { mode: "string" }),
    plannedEnd: date("planned_end", { mode: "string" }),
    bookOrder: integer("book_order"),
    bookDate: date("book_date", { mode: "string" }),
    cssInformed: boolean("css_informed").default(false).notNull(),
    // The CAE warnings the company gives this obra (its own and its workers' documents, and this obra's), as
    // the rules last worked them out, and the last day that holds; null = never worked out. Like cae_status.
    caeWarnings: integer("cae_warnings"),
    caeValidUntil: date("cae_valid_until", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    // Soft delete: set when a user deletes it. The row and its files stay; every read leaves it out.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedById: text("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    subcontractorProjectUnique: unique("subcontractor_assignments_subcontractor_project_unique").on(
      table.subcontractorId,
      table.projectId,
    ),
    tenantIdx: index("subcontractor_assignments_tenant_idx").on(table.tenantId),
    subcontractorFk: foreignKey({
      name: "subcontractor_assignments_subcontractor_id_tenant_fk",
      columns: [table.tenantId, table.subcontractorId],
      foreignColumns: [subcontractors.tenantId, subcontractors.id],
    }).onDelete("cascade"),
    projectFk: underProject("subcontractor_assignments_project_id_tenant_fk", table),
    datesCheck: inOrder("subcontractor_assignments_dates_check", table.plannedStart, table.plannedEnd),
    deletedCheck: deletedTogether("subcontractor_assignments_deleted_check", table),
    caeWarningsCheck: notNegative("subcontractor_assignments_cae_warnings_check", table.caeWarnings),
  }),
);

// Every change to a subcontractor, its workers and documents, for its Historial tab.
export const subcontractorAudit = pgTable(
  "subcontractor_audit",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    subcontractorId: text("subcontractor_id").notNull(),
    workerId: text("worker_id").references(() => subcontractorWorkers.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    // created | updated | document_uploaded | document_validated | …
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    subcontractorCreatedIdx: index("subcontractor_audit_subcontractor_created_idx").on(
      table.subcontractorId,
      table.createdAt,
    ),
    subcontractorFk: foreignKey({
      name: "subcontractor_audit_subcontractor_id_tenant_fk",
      columns: [table.tenantId, table.subcontractorId],
      foreignColumns: [subcontractors.tenantId, subcontractors.id],
    }).onDelete("cascade"),
  }),
);
