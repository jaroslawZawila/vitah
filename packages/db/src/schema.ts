import { and, eq, ne, relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
    // The portal's language for staff ("es" | "en"), picked in the rail; null
    // follows the browser. The mobile app keeps its own, on the phone.
    language: text("language").$type<"es" | "en">(),
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
    // Construction control: the accepted budget revision whose added and
    // removed chapters staff have reviewed (null: none reviewed yet).
    obraReviewedRevisionId: text("obra_reviewed_revision_id"),
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
    // The day the photo was taken (staff may set it); null: its upload day.
    takenOn: date("taken_on", { mode: "string" }),
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
    // The margins on top of the cost (chapters 01–20): gastos asociados and
    // beneficio industrial, 13 % = 1300. 0 for budgets priced before them, whose
    // unit prices already included both; new revisions get core's defaults.
    overheadBp: integer("overhead_bp").default(0).notNull(),
    profitBp: integer("profit_bp").default(0).notNull(),
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

// --- Obra: construction control ---
// The technical follow-up of a project's works (features/construction_control):
// when each budget chapter of the contract really started and finished, every
// such record and correction, the invoice requests that finishing a hito's
// last chapter creates, and a log of issues and changes. Chapters are matched
// by code, so the records hold across budget revisions. Staff only.

// One chapter's actual dates: none = pending, a start = in progress, both = finished.
export const obraChapterProgress = pgTable(
  "obra_chapter_progress",
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
    chapterCode: text("chapter_code").notNull(),
    actualStart: date("actual_start", { mode: "string" }),
    actualEnd: date("actual_end", { mode: "string" }),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectChapterUnique: unique("obra_chapter_progress_project_chapter_unique").on(
      table.projectId,
      table.chapterCode,
    ),
  }),
);

// Every recorded date and correction: the day the work happened, and who recorded it when.
export const obraProgressEvents = pgTable(
  "obra_progress_events",
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
    chapterCode: text("chapter_code").notNull(),
    // start | finish | correct_start | correct_finish
    kind: text("kind").$type<"start" | "finish" | "correct_start" | "correct_finish">().notNull(),
    // The date before and after (null: none, or cleared).
    previousDate: date("previous_date", { mode: "string" }),
    newDate: date("new_date", { mode: "string" }),
    note: text("note"),
    recordedById: text("recorded_by_id").references(() => users.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    projectIdx: index("obra_progress_events_project_idx").on(table.projectId, table.recordedAt),
  }),
);

// The request to Administration to invoice a hito, made once when its last chapter finishes.
export const obraInvoiceRequests = pgTable("obra_invoice_requests", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Unique: never a second request for the same hito.
  hitoId: text("hito_id")
    .notNull()
    .unique("obra_invoice_requests_hito_unique")
    .references(() => obraHitos.id, { onDelete: "cascade" }),
  // The chapter whose finish met the hito.
  chapterCode: text("chapter_code").notNull(),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").notNull(),
  clientName: text("client_name"),
  requestedById: text("requested_by_id").references(() => users.id, { onDelete: "set null" }),
  requestedAt: timestamp("requested_at", { mode: "date" }).defaultNow().notNull(),
});

// A problem during the works (issue) or a difference from what was planned (change).
export const obraIssues = pgTable(
  "obra_issues",
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
    // issue | change; numbered per project and kind (INC-007, CAM-004).
    kind: text("kind").$type<"issue" | "change">().notNull(),
    number: integer("number").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    chapterCode: text("chapter_code").notNull(),
    description: text("description").notNull(),
    // client | subcontractor | own | other
    party: text("party").$type<"client" | "subcontractor" | "own" | "other">().notNull(),
    partyName: text("party_name"),
    // Estimates, never required: they may not be known yet.
    costImpactCents: integer("cost_impact_cents"),
    scheduleImpactDays: integer("schedule_impact_days"),
    // pending | review | resolved
    status: text("status").$type<"pending" | "review" | "resolved">().default("pending").notNull(),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectKindNumberUnique: unique("obra_issues_project_kind_number_unique").on(
      table.projectId,
      table.kind,
      table.number,
    ),
  }),
);

// A photo, email or document supporting an issue (private Blob store).
export const obraIssueFiles = pgTable(
  "obra_issue_files",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    issueId: text("issue_id")
      .notNull()
      .references(() => obraIssues.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    pathname: text("pathname").unique().notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedById: text("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    issueIdx: index("obra_issue_files_issue_idx").on(table.issueId),
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
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    tenantTaxIdUnique: unique("subcontractors_tenant_tax_id_unique").on(table.tenantId, table.taxId),
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
    subcontractorId: text("subcontractor_id")
      .notNull()
      .references(() => subcontractors.id, { onDelete: "cascade" }),
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
    subcontractorId: text("subcontractor_id")
      .notNull()
      .references(() => subcontractors.id, { onDelete: "cascade" }),
    workerId: text("worker_id").references(() => subcontractorWorkers.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
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
    documentId: text("document_id")
      .notNull()
      .references(() => subcontractorDocuments.id, { onDelete: "cascade" }),
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
    subcontractorId: text("subcontractor_id")
      .notNull()
      .references(() => subcontractors.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chapterCodes: jsonb("chapter_codes").$type<string[]>().default([]).notNull(),
    plannedStart: date("planned_start", { mode: "string" }),
    plannedEnd: date("planned_end", { mode: "string" }),
    bookOrder: integer("book_order"),
    bookDate: date("book_date", { mode: "string" }),
    cssInformed: boolean("css_informed").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    subcontractorProjectUnique: unique("subcontractor_assignments_subcontractor_project_unique").on(
      table.subcontractorId,
      table.projectId,
    ),
    tenantIdx: index("subcontractor_assignments_tenant_idx").on(table.tenantId),
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
    subcontractorId: text("subcontractor_id")
      .notNull()
      .references(() => subcontractors.id, { onDelete: "cascade" }),
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
  }),
);

// --- Purchasing (Compras) ---

// The orders of material and the subcontracts of a project, each split across
// budget lines (by lineage, so they outlive a budget revision). What they
// contract is what the Obra tab compares with the budget's cost. Staff only.

export type PurchaseOrderKind = "material" | "subcontract";
// material: pending → ordered → confirmed → in_transit → delivered;
// subcontract: pending → contracted → finished; either may be cancelled.
export type PurchaseOrderStatus =
  | "pending"
  | "ordered"
  | "confirmed"
  | "in_transit"
  | "delivered"
  | "contracted"
  | "finished"
  | "cancelled";
// The VAT a supplier's invoice carries: 21 %, 10 %, reverse charge (a
// subcontract between contractors, art. 84 LIVA) or exempt.
export type PurchaseVatKind = "vat21" | "vat10" | "reverse_charge" | "exempt";
export type PurchaseInvoiceKind = "invoice" | "credit_note";
// A purchase request: pending (waiting for approval) → approved → ordered
// (an order was made from it); or rejected (with a reason) or cancelled.
export type PurchaseRequestStatus = "pending" | "approved" | "rejected" | "ordered" | "cancelled";
export type PurchasePaymentMethod = "transfer" | "confirming" | "promissory_note" | "direct_debit";

export const purchaseOrders = pgTable(
  "purchase_orders",
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
    // Numbered per project (PED-001).
    number: integer("number").notNull(),
    kind: text("kind").$type<PurchaseOrderKind>().notNull(),
    subcontractorId: text("subcontractor_id")
      .notNull()
      // Not cascaded (a company with orders is never deleted), yet a deleted tenant takes both.
      .references(() => subcontractors.id),
    description: text("description").notNull(),
    status: text("status").$type<PurchaseOrderStatus>().default("pending").notNull(),
    orderedOn: date("ordered_on", { mode: "string" }),
    // A material order's expected delivery; a subcontract's works period.
    expectedOn: date("expected_on", { mode: "string" }),
    workStart: date("work_start", { mode: "string" }),
    workEnd: date("work_end", { mode: "string" }),
    // Delivered (material) or finished (subcontract).
    completedOn: date("completed_on", { mode: "string" }),
    notes: text("notes"),
    // What its invoices start from: days to pay them (null: the default 30),
    // the guarantee retention, and their VAT (null: by kind).
    paymentDays: integer("payment_days"),
    retentionBp: integer("retention_bp").default(0).notNull(),
    vatKind: text("vat_kind").$type<PurchaseVatKind>(),
    // Legacy: the order's single PDF before it had documents
    // (purchase_order_documents); copied there by 2026-10-purchase-documents.sql.
    fileName: text("file_name"),
    filePathname: text("file_pathname"),
    fileSizeBytes: integer("file_size_bytes"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectNumberUnique: unique("purchase_orders_project_number_unique").on(table.projectId, table.number),
    tenantIdx: index("purchase_orders_tenant_idx").on(table.tenantId),
    subcontractorIdx: index("purchase_orders_subcontractor_idx").on(table.subcontractorId),
  }),
);

// How much of an order goes to a budget line, and whether it closes the line
// (nothing else is left to contract for it).
export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    // budget_lines.lineage_id: the same line in every revision.
    lineageId: text("lineage_id").notNull(),
    chapterCode: text("chapter_code").notNull(),
    amountCents: integer("amount_cents").notNull(),
    closesLine: boolean("closes_line").default(true).notNull(),
  },
  (table) => ({
    orderLineageUnique: unique("purchase_order_lines_order_lineage_unique").on(table.orderId, table.lineageId),
  }),
);

// Every change to an order: its creation, status, dates, amounts and lines.
export const purchaseOrderEvents = pgTable(
  "purchase_order_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    // created | status | updated | lines | file_added | file_removed
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
    note: text("note"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    orderCreatedIdx: index("purchase_order_events_order_created_idx").on(table.orderId, table.createdAt),
  }),
);

// An order's documents (the order, the signed contract, its annexes, the
// offer…), each a PDF in versions: a new upload adds one, the last is current.
export const purchaseOrderDocuments = pgTable(
  "purchase_order_documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    orderIdx: index("purchase_order_documents_order_idx").on(table.orderId),
  }),
);

// A document's file, immutable once stored; `note` says why it replaced the previous one.
export const purchaseOrderDocumentVersions = pgTable(
  "purchase_order_document_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => purchaseOrderDocuments.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    pathname: text("pathname").unique().notNull(),
    filename: text("filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    note: text("note"),
    uploadedById: text("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    documentVersionUnique: unique("purchase_order_document_versions_document_version_unique").on(
      table.documentId,
      table.version,
    ),
    tenantCreatedIdx: index("purchase_order_document_versions_tenant_created_idx").on(table.tenantId, table.createdAt),
  }),
);

// What an obra asks to buy before there is an order: material or a
// subcontract for some budget lines, with an estimate, approved (or rejected)
// by an admin; an approved one becomes an order. Numbered per project (SOL-001).
export const purchaseRequests = pgTable(
  "purchase_requests",
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
    number: integer("number").notNull(),
    kind: text("kind").$type<PurchaseOrderKind>().notNull(),
    description: text("description").notNull(),
    // The day the obra needs it by.
    neededBy: date("needed_by", { mode: "string" }),
    // A supplier the obra suggests; the order may go to another.
    subcontractorId: text("subcontractor_id").references(() => subcontractors.id, { onDelete: "set null" }),
    notes: text("notes"),
    status: text("status").$type<PurchaseRequestStatus>().default("pending").notNull(),
    decidedById: text("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { mode: "date" }),
    // Why it was rejected (or a remark on approving it).
    decisionNote: text("decision_note"),
    // The order made from it.
    orderId: text("order_id").references(() => purchaseOrders.id, { onDelete: "set null" }),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectNumberUnique: unique("purchase_requests_project_number_unique").on(table.projectId, table.number),
    tenantStatusIdx: index("purchase_requests_tenant_status_idx").on(table.tenantId, table.status),
    // An order comes from one request at most.
    orderUnique: uniqueIndex("purchase_requests_order_unique").on(table.orderId).where(sql`${table.orderId} is not null`),
  }),
);

// The budget lines (by lineage) a request asks for, with the estimate of each.
export const purchaseRequestLines = pgTable(
  "purchase_request_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    requestId: text("request_id")
      .notNull()
      .references(() => purchaseRequests.id, { onDelete: "cascade" }),
    lineageId: text("lineage_id").notNull(),
    chapterCode: text("chapter_code").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (table) => ({
    requestLineageUnique: unique("purchase_request_lines_request_lineage_unique").on(table.requestId, table.lineageId),
  }),
);

// Every change to a request: created, edited, approved, rejected, ordered, cancelled.
export const purchaseRequestEvents = pgTable(
  "purchase_request_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    requestId: text("request_id")
      .notNull()
      .references(() => purchaseRequests.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
    note: text("note"),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    requestCreatedIdx: index("purchase_request_events_request_created_idx").on(table.requestId, table.createdAt),
  }),
);

// A contract's payment schedule: how its amount is invoiced, in turn. They
// split what the order contracts, never add to it.
export const purchaseOrderMilestones = pgTable(
  "purchase_order_milestones",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    concept: text("concept").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (table) => ({
    orderIdx: index("purchase_order_milestones_order_idx").on(table.orderId),
  }),
);

// A placed order's formal modification (modificado nº 1, 2…): what changed in
// its lines, signed on a day for a reason, maybe with its signed PDF (one of
// the order's documents). The order's lines are the current ones; each
// amendment keeps the amounts before and after and the lines it changed.
export const purchaseOrderAmendments = pgTable(
  "purchase_order_amendments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    concept: text("concept").notNull(),
    signedOn: date("signed_on", { mode: "string" }).notNull(),
    amountBeforeCents: integer("amount_before_cents").notNull(),
    amountAfterCents: integer("amount_after_cents").notNull(),
    // [{ code, lineageId, from: { amountCents, closesLine } | null, to: … | null }]
    changes: jsonb("changes").$type<Record<string, unknown>[]>().default([]).notNull(),
    documentId: text("document_id").references(() => purchaseOrderDocuments.id, { onDelete: "set null" }),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orderNumberUnique: unique("purchase_order_amendments_order_number_unique").on(table.orderId, table.number),
  }),
);

// A supplier's invoice (or credit note) for an order, registered once by
// Administration. Its amounts are as invoiced: the base (without VAT) is what
// is compared with the budget's cost; what is paid is the total less the
// guarantee retention. A credit note rectifies one invoice and has a negative base.
export const purchaseInvoices = pgTable(
  "purchase_invoices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    // The order's supplier, kept here so each supplier's numbers stay unique.
    subcontractorId: text("subcontractor_id")
      .notNull()
      .references(() => subcontractors.id),
    kind: text("kind").$type<PurchaseInvoiceKind>().default("invoice").notNull(),
    // The supplier's own number.
    number: text("number").notNull(),
    // An invoiced milestone is never removed: not cascaded.
    milestoneId: text("milestone_id").references(() => purchaseOrderMilestones.id),
    rectifiesId: text("rectifies_id").references((): AnyPgColumn => purchaseInvoices.id),
    issuedOn: date("issued_on", { mode: "string" }).notNull(),
    // None for a credit note: it settles against the invoice it rectifies.
    dueOn: date("due_on", { mode: "string" }),
    baseCents: integer("base_cents").notNull(),
    vatKind: text("vat_kind").$type<PurchaseVatKind>().notNull(),
    vatCents: integer("vat_cents").notNull(),
    // Income tax withheld from a self-employed supplier.
    irpfBp: integer("irpf_bp").default(0).notNull(),
    irpfCents: integer("irpf_cents").default(0).notNull(),
    // The guarantee held back until the works' guarantee ends.
    retentionBp: integer("retention_bp").default(0).notNull(),
    retentionCents: integer("retention_cents").default(0).notNull(),
    notes: text("notes"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    supplierNumberUnique: unique("purchase_invoices_supplier_number_unique").on(
      table.tenantId,
      table.subcontractorId,
      table.number,
    ),
    orderIdx: index("purchase_invoices_order_idx").on(table.orderId),
    tenantDueIdx: index("purchase_invoices_tenant_due_idx").on(table.tenantId, table.dueOn),
    // A credit note's invoice: settling an invoice reads its credit notes.
    rectifiesIdx: index("purchase_invoices_rectifies_idx").on(table.rectifiesId),
  }),
);

// How an invoice's base splits across its order's budget lines (by lineage).
export const purchaseInvoiceLines = pgTable(
  "purchase_invoice_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: "cascade" }),
    lineageId: text("lineage_id").notNull(),
    chapterCode: text("chapter_code").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (table) => ({
    invoiceLineageUnique: unique("purchase_invoice_lines_invoice_lineage_unique").on(table.invoiceId, table.lineageId),
  }),
);

// An invoice's PDF, versioned: a new upload adds a version, none is deleted.
export const purchaseInvoiceFiles = pgTable(
  "purchase_invoice_files",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    pathname: text("pathname").unique().notNull(),
    filename: text("filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Why it replaced the previous version.
    note: text("note"),
    uploadedById: text("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    invoiceVersionUnique: unique("purchase_invoice_files_invoice_version_unique").on(table.invoiceId, table.version),
    tenantCreatedIdx: index("purchase_invoice_files_tenant_created_idx").on(table.tenantId, table.createdAt),
  }),
);

// A payment of an invoice: partial ones add up; past the amount due, the
// retention is being released.
export const purchasePayments = pgTable(
  "purchase_payments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: "cascade" }),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: text("method").$type<PurchasePaymentMethod>().notNull(),
    reference: text("reference"),
    // The proof of payment (PDF, private Blob store).
    fileName: text("file_name"),
    filePathname: text("file_pathname"),
    fileSizeBytes: integer("file_size_bytes"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    invoiceIdx: index("purchase_payments_invoice_idx").on(table.invoiceId),
    tenantPaidIdx: index("purchase_payments_tenant_paid_idx").on(table.tenantId, table.paidOn),
    tenantCreatedIdx: index("purchase_payments_tenant_created_idx").on(table.tenantId, table.createdAt),
  }),
);

export type PurchaseCheckStatus = "pending" | "running" | "done" | "failed" | "skipped";

// The AI's review of one purchase PDF (an order document's version, an
// invoice's PDF or a payment's proof): warnings only, it never changes a
// record or a file. Exactly one subject is set; a check goes with its
// subject. `sha256` finds the same file uploaded twice.
export const purchaseDocumentChecks = pgTable(
  "purchase_document_checks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    documentVersionId: text("document_version_id").references(() => purchaseOrderDocumentVersions.id, { onDelete: "cascade" }),
    invoiceFileId: text("invoice_file_id").references(() => purchaseInvoiceFiles.id, { onDelete: "cascade" }),
    paymentId: text("payment_id").references(() => purchasePayments.id, { onDelete: "cascade" }),
    // The file reviewed (a payment's proof may be replaced: a new one is reviewed again).
    pathname: text("pathname").notNull(),
    label: text("label").notNull(),
    sha256: text("sha256"),
    status: text("status").$type<PurchaseCheckStatus>().default("pending").notNull(),
    // [{ kind, detail: { es, en } | null, duplicate?: { label, orderId, invoiceId } }]
    findings: jsonb("findings").$type<Record<string, unknown>[]>().default([]).notNull(),
    // Why it wasn't reviewed (`ai_limit`) or what failed.
    reason: text("reason"),
    // When a run took it (one left running past 15 minutes is taken again), and when it ended.
    startedAt: timestamp("started_at"),
    checkedAt: timestamp("checked_at"),
    dismissedAt: timestamp("dismissed_at"),
    dismissedById: text("dismissed_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    versionUnique: unique("purchase_document_checks_version_unique").on(table.documentVersionId),
    invoiceFileUnique: unique("purchase_document_checks_invoice_file_unique").on(table.invoiceFileId),
    paymentUnique: unique("purchase_document_checks_payment_unique").on(table.paymentId),
    tenantStatusIdx: index("purchase_document_checks_tenant_status_idx").on(table.tenantId, table.status),
    tenantShaIdx: index("purchase_document_checks_tenant_sha_idx").on(table.tenantId, table.sha256),
    orderIdx: index("purchase_document_checks_order_idx").on(table.orderId),
  }),
);

// --- Planning (the works schedule) ---

export type PlanningVersionStatus = "draft" | "approved" | "superseded";

// A project's schedule, by version: a draft is edited freely; approving it makes
// it the baseline (the previous one superseded). One draft and one baseline at most.
export const planningVersions = pgTable(
  "planning_versions",
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
    number: integer("number").notNull(),
    status: text("status").$type<PlanningVersionStatus>().default("draft").notNull(),
    // The day the works start (acta de inicio) and the working calendar.
    startDate: date("start_date", { mode: "string" }).notNull(),
    // An autonomous community's holidays (as, cb, cl, ga, md); null = national only.
    region: text("region"),
    augustClosure: boolean("august_closure").default(true).notNull(),
    christmasClosure: boolean("christmas_closure").default(true).notNull(),
    // Why it changed: required to approve a version after the first.
    reason: text("reason"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    approvedById: text("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { mode: "date" }),
  },
  (table) => ({
    projectNumberUnique: unique("planning_versions_project_number_unique").on(table.projectId, table.number),
    oneDraft: uniqueIndex("planning_versions_one_draft")
      .on(table.projectId)
      .where(sql`${table.status} = 'draft'`),
    oneApproved: uniqueIndex("planning_versions_one_approved")
      .on(table.projectId)
      .where(sql`${table.status} = 'approved'`),
  }),
);

// One row per contract chapter: what it waits for, how long it takes in working
// days, and the dates that gives (stored, so a baseline never moves).
export const planningItems = pgTable(
  "planning_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => planningVersions.id, { onDelete: "cascade" }),
    chapterCode: text("chapter_code").notNull(),
    position: integer("position").notNull(),
    // Starts the working day after this chapter ends (+ lag); null = at `fixed_start` or the works' start.
    afterCode: text("after_code"),
    lagDays: integer("lag_days").default(0).notNull(),
    durationDays: integer("duration_days").notNull(),
    fixedStart: date("fixed_start", { mode: "string" }),
    // Runs through the whole works (quality control, health and safety, waste).
    spansWorks: boolean("spans_works").default(false).notNull(),
    // Calendar days before its start its orders must be placed (suppliers' lead time).
    leadDays: integer("lead_days").default(0).notNull(),
    plannedStart: date("planned_start", { mode: "string" }).notNull(),
    plannedEnd: date("planned_end", { mode: "string" }).notNull(),
  },
  (table) => ({
    versionChapterUnique: unique("planning_items_version_chapter_unique").on(table.versionId, table.chapterCode),
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
