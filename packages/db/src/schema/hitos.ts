// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import { basisPoints } from "./checks";
import { projectPhotos } from "./project-files";
import { tenants } from "./tenants";
import { underProject } from "./under-project";

// --- Obra: payment milestones (hitos H0–H9) ---
// Per project, not per revision: amounts are % × the accepted revision's total.

export const obraHitos = pgTable(
  "obra_hitos",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    // "H4".
    code: text("code").notNull(),
    name: text("name").notNull(),
    // Share of the price in basis points: 13 % = 1300.
    pctBp: integer("pct_bp").notNull(),
    // "Alcance / contenido" and "Momento de facturación".
    scope: text("scope").notNull(),
    billingMoment: text("billing_moment").notNull(),
    position: integer("position").notNull(),
    // The signed acta fotográfica de conformidad (PDF, private Blob store).
    actaSignedOn: date("acta_signed_on", { mode: "string" }),
    actaPathname: text("acta_pathname"),
    actaSizeBytes: integer("acta_size_bytes"),
    // The invoice (PDF).
    invoicedOn: date("invoiced_on", { mode: "string" }),
    invoicePathname: text("invoice_pathname"),
    invoiceSizeBytes: integer("invoice_size_bytes"),
    paidOn: date("paid_on", { mode: "string" }),
    paidAmountCents: integer("paid_amount_cents"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectCodeUnique: unique("obra_hitos_project_code_unique").on(table.projectId, table.code),
    tenantIdUnique: unique("obra_hitos_id_tenant_id_unique").on(table.id, table.tenantId),
    projectFk: underProject("obra_hitos_project_id_tenant_fk", table),
    pctCheck: basisPoints("obra_hitos_pct_bp_check", table.pctBp),
    sizesCheck: check("obra_hitos_sizes_check", sql`${table.actaSizeBytes} >= 0 and ${table.invoiceSizeBytes} >= 0`),
    // A payment is a day and at least a cent, registered and cancelled together.
    paymentCheck: check(
      "obra_hitos_payment_check",
      sql`(${table.paidOn} is null) = (${table.paidAmountCents} is null) and ${table.paidAmountCents} > 0`,
    ),
  }),
);

// The budget chapters a hito closes, by chapter code (so it holds across
// revisions). A chapter belongs to at most one hito.
export const obraHitoChapters = pgTable(
  "obra_hito_chapters",
  {
    hitoId: text("hito_id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    chapterCode: text("chapter_code").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.hitoId, table.chapterCode] }),
    projectChapterUnique: unique("obra_hito_chapters_project_chapter_unique").on(
      table.projectId,
      table.chapterCode,
    ),
    hitoFk: foreignKey({
      name: "obra_hito_chapters_hito_id_tenant_fk",
      columns: [table.tenantId, table.hitoId],
      foreignColumns: [obraHitos.tenantId, obraHitos.id],
    }).onDelete("cascade"),
    projectFk: underProject("obra_hito_chapters_project_id_tenant_fk", table),
  }),
);

// What else must be done before a hito's acta: tests, handover documents…
export const obraHitoChecks = pgTable(
  "obra_hito_checks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    hitoId: text("hito_id").notNull(),
    label: text("label").notNull(),
    done: boolean("done").default(false).notNull(),
    position: integer("position").notNull(),
  },
  (table) => ({
    hitoIdx: index("obra_hito_checks_hito_idx").on(table.hitoId),
    hitoFk: foreignKey({
      name: "obra_hito_checks_hito_id_tenant_fk",
      columns: [table.tenantId, table.hitoId],
      foreignColumns: [obraHitos.tenantId, obraHitos.id],
    }).onDelete("cascade"),
  }),
);

// Project photos picked for a hito's acta fotográfica.
export const obraHitoPhotos = pgTable(
  "obra_hito_photos",
  {
    hitoId: text("hito_id").notNull(),
    photoId: text("photo_id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.hitoId, table.photoId] }),
    hitoFk: foreignKey({
      name: "obra_hito_photos_hito_id_tenant_fk",
      columns: [table.tenantId, table.hitoId],
      foreignColumns: [obraHitos.tenantId, obraHitos.id],
    }).onDelete("cascade"),
    photoFk: foreignKey({
      name: "obra_hito_photos_photo_id_tenant_fk",
      columns: [table.tenantId, table.photoId],
      foreignColumns: [projectPhotos.tenantId, projectPhotos.id],
    }).onDelete("cascade"),
  }),
);
