// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, date, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { budgetApprovals } from "./budget-approvals";
import { basisPoints, COLUMN_VALUES, notNegative, oneOf } from "./checks";
import { budgetRevisionStatusEnum } from "./enums";
import { projectDocuments } from "./project-files";
import { tenants } from "./tenants";
import { underProject } from "./under-project";
import { users } from "./users";

// --- Obra: budget ---
// A project's budget (PEC) in the FRAMER model: revisions → chapters → lines
// (partidas). Money is in euro cents, quantities in thousandths. The accepted
// revision drives the works; staff record each line's executed %.

export const budgetRevisions = pgTable(
  "budget_revisions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    // "Rev.3" → 3.
    number: integer("number").notNull(),
    status: budgetRevisionStatusEnum("status").default("draft").notNull(),
    // The budget's own number, e.g. "036/2026".
    reference: text("reference"),
    // VAT in basis points: 10 % (autopromoción) = 1000.
    vatRateBp: integer("vat_rate_bp").default(1000).notNull(),
    // Surfaces in hundredths of m² (253,45 m² → 25345).
    builtAreaCm2: integer("built_area_cm2"),
    usefulAreaCm2: integer("useful_area_cm2"),
    // "Gastos no incluidos en el PEC", one per line.
    exclusions: text("exclusions"),
    // "framer20": the FRAMER model (fixed chapters 01–20 + options). Null for
    // budgets entered before it, whose chapters are free.
    model: text("model"),
    // Chapter 20 (Imprevistos) as a share of chapters 01–19: 5 % = 500.
    contingencyBp: integer("contingency_bp").default(500).notNull(),
    // The margins on top of the cost (chapters 01–20): gastos asociados and
    // beneficio industrial, 13 % = 1300. 0 for budgets priced before them, whose
    // unit prices already included both; new revisions get core's defaults.
    overheadBp: integer("overhead_bp").default(0).notNull(),
    profitBp: integer("profit_bp").default(0).notNull(),
    // The AI's quality reference: framer | project.
    quality: text("quality").$type<(typeof COLUMN_VALUES.budgetQuality)[number]>(),
    // What the PDFs print besides numbers (BudgetTexts in core's contract).
    texts: jsonb("texts"),
    // Validity, term, penalty, signing place (BudgetConditions).
    conditions: jsonb("conditions"),
    // The pre-issue checklist: { done: string[] } (core budget-review.ts).
    review: jsonb("review"),
    // "Motivo de la revisión": required to issue Rev.1 and later.
    changeReason: text("change_reason"),
    issuedOn: date("issued_on", { mode: "string" }),
    validUntil: date("valid_until", { mode: "string" }),
    acceptedOn: date("accepted_on", { mode: "string" }),
    acceptedBy: text("accepted_by"),
    // The staff user who registered the acceptance (`acceptedBy` is the client's
    // name as typed), and the client's signed copy filed with the documents.
    // Both null on revisions accepted before they were kept.
    acceptedByUserId: text("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedDocumentId: text("accepted_document_id").references(
      (): AnyPgColumn => projectDocuments.id,
      { onDelete: "set null" },
    ),
    // The client's approval in the app (budget_approvals) registered as proof
    // beside the signed copy: set when the options accepted are the ones approved.
    acceptedApprovalId: text("accepted_approval_id").references(
      (): AnyPgColumn => budgetApprovals.id,
      { onDelete: "set null" },
    ),
    rejectedOn: date("rejected_on", { mode: "string" }),
    // The AI run that drafted it (Rev.0).
    generationId: text("generation_id"),
    acceptedAt: timestamp("accepted_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectNumberUnique: unique("budget_revisions_project_number_unique").on(
      table.projectId,
      table.number,
    ),
    tenantIdUnique: unique("budget_revisions_id_tenant_id_unique").on(table.id, table.tenantId),
    projectFk: underProject("budget_revisions_project_id_tenant_fk", table),
    numberCheck: notNegative("budget_revisions_number_check", table.number),
    modelCheck: oneOf("budget_revisions_model_check", table.model, COLUMN_VALUES.budgetModel),
    qualityCheck: oneOf("budget_revisions_quality_check", table.quality, COLUMN_VALUES.budgetQuality),
    vatRateCheck: basisPoints("budget_revisions_vat_rate_bp_check", table.vatRateBp),
    contingencyCheck: basisPoints("budget_revisions_contingency_bp_check", table.contingencyBp),
    overheadCheck: basisPoints("budget_revisions_overhead_bp_check", table.overheadBp),
    // A margin on the price: at 100 % there would be no price.
    profitCheck: check("budget_revisions_profit_bp_check", sql`${table.profitBp} >= 0 and ${table.profitBp} < 10000`),
    areasCheck: check(
      "budget_revisions_areas_check",
      sql`${table.builtAreaCm2} >= 0 and ${table.usefulAreaCm2} >= 0`,
    ),
  }),
);

export const budgetChapters = pgTable(
  "budget_chapters",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    revisionId: text("revision_id").notNull(),
    // "05". Chapters keep their code across revisions.
    code: text("code").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    // Why the chapter changed against the previous revision.
    changeNote: text("change_note"),
    // chapter (01–20) | option (OP1, OP2…: priced apart, below the PEC).
    kind: text("kind").$type<(typeof COLUMN_VALUES.budgetChapterKind)[number]>().default("chapter").notNull(),
    // Printed under the title in the PDFs: a chapter's "Sustituye a…" note, an option's presentation.
    pdfNote: text("pdf_note"),
    // Options only: extra | alternative | deduction.
    optionKind: text("option_kind").$type<(typeof COLUMN_VALUES.budgetOptionKind)[number]>(),
    // Alternatives: the line code they replace ("10.02").
    replacesLine: text("replaces_line"),
    // Options: whether the client chose it, set when the revision is accepted.
    chosen: boolean("chosen"),
  },
  (table) => ({
    revisionCodeUnique: unique("budget_chapters_revision_code_unique").on(
      table.revisionId,
      table.code,
    ),
    tenantIdUnique: unique("budget_chapters_id_tenant_id_unique").on(table.id, table.tenantId),
    // Cascaded: a draft revision is deleted for real.
    revisionFk: foreignKey({
      name: "budget_chapters_revision_id_tenant_fk",
      columns: [table.tenantId, table.revisionId],
      foreignColumns: [budgetRevisions.tenantId, budgetRevisions.id],
    }).onDelete("cascade"),
    kindCheck: oneOf("budget_chapters_kind_check", table.kind, COLUMN_VALUES.budgetChapterKind),
    optionKindCheck: oneOf("budget_chapters_option_kind_check", table.optionKind, COLUMN_VALUES.budgetOptionKind),
  }),
);

export const budgetLines = pgTable(
  "budget_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id").notNull(),
    // "05.01".
    code: text("code").notNull(),
    description: text("description").notNull(),
    // m², m³, ml, ud, pa, lote…
    unit: text("unit").notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    // Share of the line built so far, 0–100.
    executedPct: integer("executed_pct").default(0).notNull(),
    // base (from the price base) | estimated (AI, not in the base) | manual | computed (20.01).
    source: text("source").$type<(typeof COLUMN_VALUES.budgetLineSource)[number]>().default("manual").notNull(),
    // The price base code it came from ("03.14").
    baseCode: text("base_code"),
    // The AI's or staff's note on the measurement or price.
    note: text("note"),
    // The same line across revisions: copied with it into each new revision,
    // so changes and progress follow the line even when its code changes.
    lineageId: text("lineage_id")
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    position: integer("position").notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    chapterIdx: index("budget_lines_chapter_idx").on(table.chapterId),
    // Cascaded: a draft's chapters and lines are deleted for real.
    chapterFk: foreignKey({
      name: "budget_lines_chapter_id_tenant_fk",
      columns: [table.tenantId, table.chapterId],
      foreignColumns: [budgetChapters.tenantId, budgetChapters.id],
    }).onDelete("cascade"),
    sourceCheck: oneOf("budget_lines_source_check", table.source, COLUMN_VALUES.budgetLineSource),
    // An option's line may subtract by its price, never by its quantity.
    quantityCheck: notNegative("budget_lines_quantity_milli_check", table.quantityMilli),
    executedCheck: check("budget_lines_executed_pct_check", sql`${table.executedPct} between 0 and 100`),
  }),
);
