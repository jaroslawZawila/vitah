import { and, eq, ne, relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// --- Enums ---

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "manager",
  "viewer",
  // Homeowner using the mobile app. Cannot sign in to the portal.
  "client",
]);

export type UserRole = (typeof userRoleEnum.enumValues)[number];

export const documentCategoryEnum = pgEnum("document_category", [
  "contract",
  "plans",
  "certificates",
  "other",
  // The budget's input documents and its PDFs (features/budget/TECH_DESIGN.md §3.4).
  "budget",
]);
export type StaffRole = Exclude<UserRole, "client">;

// A budget revision is drafted, issued to the client (frozen, with its PDFs),
// then accepted (it becomes the contract) or rejected; it is superseded when a
// later revision is accepted.
export const budgetRevisionStatusEnum = pgEnum("budget_revision_status", [
  "draft",
  "accepted",
  "superseded",
  "issued",
  "rejected",
]);
export const STAFF_ROLES = userRoleEnum.enumValues.filter(
  (role): role is StaffRole => role !== "client",
);

// --- Tenants ---

export const tenants = pgTable("tenants", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  active: boolean("active").default(true).notNull(),
  // Monthly spend cap for AI calls, in US cents (Claude bills in USD); null = no limit.
  aiMonthlyLimitCents: integer("ai_monthly_limit_cents"),
  // The company's letterhead on budget PDFs: { name, tagline, address, phone }.
  letterhead: jsonb("letterhead"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- Users ---

export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { mode: "date" }),
    image: text("image"),
    passwordHash: text("password_hash"),
    role: userRoleEnum("role").default("viewer").notNull(),
    active: boolean("active").default(true).notNull(),
    // Mobile tokens issued before this are revoked (password changed or reset).
    passwordChangedAt: timestamp("password_changed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    tenantEmailUnique: unique("users_tenant_email_unique").on(table.tenantId, table.email),
    // Logins look users up by email alone (clients on mobile, staff on the
    // portal), so an email is unique across tenants within each audience.
    clientEmailUnique: uniqueIndex("users_client_email_unique")
      .on(table.email)
      .where(sql`${table.role} = 'client'`),
    staffEmailUnique: uniqueIndex("users_staff_email_unique")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.role} <> 'client'`),
  }),
);

// --- Login throttling ---

// Failed sign-ins per key (an email or an IP) in the current window; see
// packages/core/src/throttle.ts. Not tenant data: a key may match no user.
export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  failures: integer("failures").default(0).notNull(),
  windowStart: timestamp("window_start", { mode: "date" }).defaultNow().notNull(),
});

// --- Client profiles ---

// Personal details of a mobile-app client (a `users` row with role "client").
// Login data (email, password) stays on `users`.
export const clientProfiles = pgTable("client_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  surnames: text("surnames").notNull(),
  // Calendar date, YYYY-MM-DD.
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  address: text("address"),
  phone: text("phone"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- Client app settings ---

// A mobile-app client's notification choices, set from the app's Perfil tab.
// No row means the defaults (DEFAULT_SETTINGS in @repo/core): all on.
export const clientSettings = pgTable("client_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  notifyProgress: boolean("notify_progress").default(true).notNull(),
  notifyDocuments: boolean("notify_documents").default(true).notNull(),
  notifyMessages: boolean("notify_messages").default(true).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// An Expo push token of a phone signed in to the app. A phone belongs to
// whoever signed in on it last, so the token itself is the key. `language`
// is the phone's app language ("es" | "en"): pushes are written in it.
export const pushTokens = pgTable(
  "push_tokens",
  {
    token: text("token").primaryKey(),
    language: text("language").default("es").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("push_tokens_user_idx").on(table.userId),
  }),
);

/** SQL filters splitting portal staff from mobile-app clients. */
export const isClientUser = eq(users.role, "client");
export const isStaffUser = ne(users.role, "client");

/** The staff member with this (lower-cased) email, in any tenant: matches `users_staff_email_unique`. */
export const staffWithEmail = (email: string) =>
  and(sql`lower(${users.email}) = ${email}`, isStaffUser);

// --- NextAuth adapter tables (for future OAuth / DB sessions) ---

export const accounts = pgTable("accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});

export const sessions = pgTable("sessions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sessionToken: text("session_token").unique().notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

// --- Projects ---

export const projects = pgTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    // Full address of the home.
    address: text("address").notNull(),
    startDate: timestamp("start_date", { mode: "date" }),
    completionDate: timestamp("completion_date", { mode: "date" }),
    // Stage of the construction process, 1–8 (features/construction_process/
    // PROCESS.md §2): set by staff on the project's Obra page.
    obraStage: integer("obra_stage").default(1).notNull(),
    // Homeowner with mobile app access. At most one project per client.
    clientUserId: text("client_user_id")
      .unique("projects_client_user_unique")
      .references(() => users.id, { onDelete: "set null" }),
    // Change counters the client's open app polls (packages/core/src/changes.ts):
    // each goes up after a write to that part of the app.
    projectRev: integer("project_rev").default(0).notNull(),
    obraRev: integer("obra_rev").default(0).notNull(),
    photosRev: integer("photos_rev").default(0).notNull(),
    documentsRev: integer("documents_rev").default(0).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    tenantRefUnique: unique("projects_tenant_ref_unique").on(
      table.tenantId,
      table.ref,
    ),
  }),
);

// --- Project documents ---

// A PDF shared with the project's client. The file lives in a private Vercel
// Blob store under `pathname`; it is only ever served through our API.
export const projectDocuments = pgTable(
  "project_documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: documentCategoryEnum("category").notNull(),
    pathname: text("pathname").unique().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Whether the project's client sees it in the app. Budget inputs and the
    // detailed budget PDF are staff-only by default.
    visibleToClient: boolean("visible_to_client").default(true).notNull(),
    contentType: text("content_type").default("application/pdf").notNull(),
    // The uploaded file's own name (budget inputs can be BC3 or spreadsheets).
    filename: text("filename"),
    // Set on the documents a budget was generated from: plans | basic | execution | measurements.
    budgetInput: text("budget_input").$type<"plans" | "basic" | "execution" | "measurements">(),
    // Set on the PDFs of an issued budget revision: general | detailed.
    budgetRevisionId: text("budget_revision_id").references(() => budgetRevisions.id, {
      onDelete: "set null",
    }),
    budgetPdf: text("budget_pdf").$type<"general" | "detailed">(),
    // The file's id in Claude's Files API, reused across generations.
    claudeFileId: text("claude_file_id"),
    uploadedById: text("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    projectIdx: index("project_documents_project_idx").on(table.projectId),
  }),
);

// --- Project photos ---

// A site photo shared with the project's client (JPEG, PNG or WebP). Stored
// like documents: private Blob store, only served through our API.
export const projectPhotos = pgTable(
  "project_photos",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    caption: text("caption"),
    pathname: text("pathname").unique().notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Budget chapter the photo shows (e.g. "05"), if any: the photo then also
    // appears on that chapter and on its phase in the app.
    chapterCode: text("chapter_code"),
    // Size of the small copy for grids, stored next to the photo as
    // "<id>.thumb.webp". Null for photos uploaded before thumbnails existed.
    thumbSizeBytes: integer("thumb_size_bytes"),
    uploadedById: text("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    projectIdx: index("project_photos_project_idx").on(table.projectId),
  }),
);

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
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
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
    // The AI's quality reference: framer | project.
    quality: text("quality").$type<"framer" | "project">(),
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
    revisionId: text("revision_id")
      .notNull()
      .references(() => budgetRevisions.id, { onDelete: "cascade" }),
    // "05". Chapters keep their code across revisions.
    code: text("code").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    // Why the chapter changed against the previous revision.
    changeNote: text("change_note"),
    // chapter (01–20) | option (OP1, OP2…: priced apart, below the PEC).
    kind: text("kind").$type<"chapter" | "option">().default("chapter").notNull(),
    // Printed under the title in the PDFs: a chapter's "Sustituye a…" note, an option's presentation.
    pdfNote: text("pdf_note"),
    // Options only: extra | alternative | deduction.
    optionKind: text("option_kind").$type<"extra" | "alternative" | "deduction">(),
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
    chapterId: text("chapter_id")
      .notNull()
      .references(() => budgetChapters.id, { onDelete: "cascade" }),
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
    source: text("source").$type<"base" | "estimated" | "manual" | "computed">().default("manual").notNull(),
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
  }),
);

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
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
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
  }),
);

// The budget chapters a hito closes, by chapter code (so it holds across
// revisions). A chapter belongs to at most one hito.
export const obraHitoChapters = pgTable(
  "obra_hito_chapters",
  {
    hitoId: text("hito_id")
      .notNull()
      .references(() => obraHitos.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chapterCode: text("chapter_code").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.hitoId, table.chapterCode] }),
    projectChapterUnique: unique("obra_hito_chapters_project_chapter_unique").on(
      table.projectId,
      table.chapterCode,
    ),
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
    hitoId: text("hito_id")
      .notNull()
      .references(() => obraHitos.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    done: boolean("done").default(false).notNull(),
    position: integer("position").notNull(),
  },
  (table) => ({
    hitoIdx: index("obra_hito_checks_hito_idx").on(table.hitoId),
  }),
);

// Project photos picked for a hito's acta fotográfica.
export const obraHitoPhotos = pgTable(
  "obra_hito_photos",
  {
    hitoId: text("hito_id")
      .notNull()
      .references(() => obraHitos.id, { onDelete: "cascade" }),
    photoId: text("photo_id")
      .notNull()
      .references(() => projectPhotos.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.hitoId, table.photoId] }),
  }),
);

// --- Budget: AI generation ---

// One run of the AI that drafts a project's first budget from its documents
// (core budget-ai/pipeline.ts, run as a Vercel Workflow).
export const budgetGenerations = pgTable(
  "budget_generations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // queued | running | succeeded | failed | cancelled
    status: text("status").$type<"queued" | "running" | "succeeded" | "failed" | "cancelled">().notNull(),
    // 0–5, for the progress bar.
    step: integer("step").default(0).notNull(),
    // [{ at, step, kind: info | done | error, text }]
    log: jsonb("log").default([]).notNull(),
    // { reference, quality, vatRateBp }
    options: jsonb("options").notNull(),
    documentIds: text("document_ids").array().notNull(),
    // Step 1's result: the project as the AI read it.
    extracted: jsonb("extracted"),
    // The pipeline's working data: the inputs as sent to Claude and steps 2–5's
    // results by group, so a retried step picks up where it was.
    state: jsonb("state").default({}).notNull(),
    revisionId: text("revision_id").references(() => budgetRevisions.id, { onDelete: "set null" }),
    workflowRunId: text("workflow_run_id"),
    error: text("error"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectIdx: index("budget_generations_project_idx").on(table.projectId),
  }),
);

// One Claude API call: tokens and cost, for spend tracking per tenant.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    generationId: text("generation_id").references(() => budgetGenerations.id, { onDelete: "set null" }),
    // budget.extract | budget.group.0 …
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").default(0).notNull(),
    cacheWriteTokens: integer("cache_write_tokens").default(0).notNull(),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    tenantCreatedIdx: index("ai_usage_tenant_created_idx").on(table.tenantId, table.createdAt),
  }),
);

// --- Relations ---

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  projects: many(projects),
}));

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  clientProfile: one(clientProfiles),
}));

export const clientProfilesRelations = relations(clientProfiles, ({ one }) => ({
  user: one(users, {
    fields: [clientProfiles.userId],
    references: [users.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [projects.tenantId],
    references: [tenants.id],
  }),
  client: one(users, {
    fields: [projects.clientUserId],
    references: [users.id],
  }),
  documents: many(projectDocuments),
  photos: many(projectPhotos),
}));

export const projectDocumentsRelations = relations(projectDocuments, ({ one }) => ({
  project: one(projects, {
    fields: [projectDocuments.projectId],
    references: [projects.id],
  }),
}));

export const projectPhotosRelations = relations(projectPhotos, ({ one }) => ({
  project: one(projects, {
    fields: [projectPhotos.projectId],
    references: [projects.id],
  }),
}));
