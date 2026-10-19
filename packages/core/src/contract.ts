// Types and constants shared with clients (mobile app, browser components).
// Must not import server-only code: importing this file never pulls in the
// database.

export const MIN_PASSWORD_LENGTH = 8;

/** Project data exposed to the mobile app. Dates are calendar dates (YYYY-MM-DD). */
export type MobileProject = {
  id: string;
  ref: string;
  address: string;
  startDate: string | null;
  completionDate: string | null;
};

/** The parts of the app that reload on their own when staff change them. */
export const CHANGE_AREAS = ["project", "obra", "photos", "documents"] as const;
export type ChangeArea = (typeof CHANGE_AREAS)[number];

/**
 * GET /api/mobile/changes: a counter per part of the app for the client's
 * project. The open app polls it and reloads a part when its counter moves.
 */
export type MobileChanges = { projectId: string } & Record<ChangeArea, number>;

export type ProjectClientError =
  | "missing_fields"
  | "project_not_found"
  | "client_not_found"
  | "client_already_attached"
  | "client_has_project"
  | "no_client"
  | "forbidden";

/** A client offered when picking a project's client. */
export type ClientOption = { id: string; name: string | null; email: string };

/** A mobile-app client as listed in the portal and by GET /api/v1/clients. */
export type ClientListItem = {
  id: string;
  email: string;
  // Null for clients created before profiles existed.
  firstName: string | null;
  surnames: string | null;
  /** Calendar date, YYYY-MM-DD. */
  dateOfBirth: string | null;
  address: string | null;
  phone: string | null;
  active: boolean;
  /** ISO timestamp. */
  createdAt: string;
};

/** Error codes of the clients service (`{ error: code }` in the API). */
export type ClientError =
  | "missing_fields"
  | "invalid_email"
  | "invalid_date_of_birth"
  | "invalid_phone"
  | "password_too_short"
  | "email_exists"
  | "not_found"
  | "forbidden";

/** Response of POST /api/mobile/auth. */
export type MobileSession = {
  token: string;
  user: { id: string; email: string; name: string | null; tenantId: string };
};

export const DOCUMENT_CATEGORIES = ["contract", "plans", "certificates", "other", "budget"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/**
 * Largest PDF accepted. Uploads pass through our functions, whose request body
 * is capped at 4.5 MB by Vercel; this leaves room for the form overhead.
 */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

/** A project document as listed by GET /api/mobile/documents. */
export type MobileDocument = {
  id: string;
  title: string;
  category: DocumentCategory;
  sizeBytes: number;
  /** ISO timestamp. */
  uploadedAt: string;
};

/** The documents a budget is generated from (TECH_DESIGN §6.3). */
export const BUDGET_INPUTS = ["plans", "basic", "execution", "measurements"] as const;
export type BudgetInput = (typeof BUDGET_INPUTS)[number];

/** Largest file uploaded straight to the store from the browser (budget inputs). */
export const MAX_DIRECT_UPLOAD_BYTES = 100 * 1024 * 1024;

/** File types a budget input may have: extension → stored MIME type. */
export const BUDGET_INPUT_EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // FIEBDC-3 measurements; there is no registered type.
  bc3: "application/octet-stream",
};

/** A project document as listed in the portal and by /api/v1. */
export type ProjectDocument = MobileDocument & {
  uploadedBy: string | null;
  visibleToClient: boolean;
  contentType: string;
  /** The uploaded file's name, when it isn't a PDF named after the title. */
  filename: string | null;
  /** Set on a document a budget was generated from. */
  budgetInput: BudgetInput | null;
  /** Set on the PDFs of an issued budget revision. */
  budgetPdf: BudgetPdfKind | null;
};

/** Error codes of the documents service (`{ error: code }` in the API). */
export type DocumentError =
  | "budget_document"
  | "generation_running"
  | "missing_fields"
  | "missing_file"
  | "invalid_category"
  | "invalid_file_type"
  | "file_too_large"
  | "project_not_found"
  | "not_found"
  | "forbidden";

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

/** Largest photo accepted; same body limit as documents. */
export const MAX_PHOTO_BYTES = MAX_DOCUMENT_BYTES;

/** Which file of a photo to fetch: the original, or a small copy for grids. */
export const PHOTO_SIZES = ["full", "thumb"] as const;
export type PhotoSize = (typeof PHOTO_SIZES)[number];

/** The query string asking a photo URL for `size`: "" or "?size=thumb". */
export const photoSizeQuery = (size: PhotoSize) => (size === "full" ? "" : `?size=${size}`);

/** Reads `?size=`; anything missing or unknown means the original. */
export const parsePhotoSize = (value: string | null): PhotoSize =>
  PHOTO_SIZES.find((size) => size === value) ?? "full";

/** Longer captions are cut to this length. */
export const MAX_CAPTION_LENGTH = 200;

/** A site photo as listed by GET /api/mobile/photos. */
export type MobilePhoto = {
  id: string;
  caption: string | null;
  sizeBytes: number;
  /** ISO timestamp. */
  uploadedAt: string;
};

/** A site photo as listed in the portal and by /api/v1. */
export type ProjectPhoto = MobilePhoto & {
  uploadedBy: string | null;
  /** The budget chapter it shows, if any. */
  chapterCode: string | null;
  /** The day it was taken, YYYY-MM-DD: as staff set it, else its upload day. */
  takenOn: string;
};

/** Error codes of the photos service (`{ error: code }` in the API). */
export type PhotoError =
  | "missing_file"
  | "invalid_date"
  | "invalid_file_type"
  | "file_too_large"
  | "project_not_found"
  | "not_found"
  | "forbidden";

// ─── Client account (app Perfil tab) ─────────────────────────────────────────

export const APP_LANGUAGES = ["es", "en"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];
/** Also the portal's languages: each staff user picks theirs. */
export const isAppLanguage = (value: unknown): value is AppLanguage =>
  APP_LANGUAGES.includes(value as AppLanguage);

/** Which push notifications a client wants. */
export type NotificationPrefs = {
  /** New site photos. */
  progress: boolean;
  /** New documents. */
  documents: boolean;
  /** Messages from the team (nothing sends these yet). */
  messages: boolean;
};

/** GET/PUT /api/mobile/settings. (The language belongs to the phone: see /push-token.) */
export type MobileSettings = { notifications: NotificationPrefs };

/**
 * The rule for a password a client picks in the app: at least 10 characters,
 * with an uppercase letter and a number. Passwords staff set in the portal
 * only need MIN_PASSWORD_LENGTH.
 */
export function isStrongPassword(password: string) {
  return password.length >= 10 && /[A-Z]/.test(password) && /\d/.test(password);
}

/** Error codes of the client account service (`{ error: code }` in the API). */
export type AccountError =
  | "missing_fields"
  | "wrong_password"
  | "too_many_attempts"
  | "weak_password"
  | "invalid_settings"
  | "invalid_token"
  | "not_found";

// ─── Obra: budget, progress and payment hitos ────────────────────────────────
// features/construction_process/PROCESS.md. Money is in euro cents; `…Pct` are
// whole percents; `…Bp` are basis points (13 % = 1300). Dates are YYYY-MM-DD.

/** Stages of the construction process, 1–8 (PROCESS.md §2). */
export const OBRA_STAGES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type ObraStage = (typeof OBRA_STAGES)[number];
/** Stage 6: the works themselves, from the acta de inicio. */
export const EXECUTION_STAGE: ObraStage = 6;

export type BudgetRevisionStatus = "draft" | "issued" | "accepted" | "rejected" | "superseded";
/** A chapter's, phase's or line's progress. */
export type ProgressStatus = "pending" | "active" | "done";
/**
 * A payment hito's statuses, in order: work under way → ready for its acta
 * (chapters at 100 % and checks done) → acta signed → invoiced → paid.
 */
export const HITO_STATUSES = ["pending", "active", "ready", "signed", "invoiced", "paid"] as const;
export type HitoStatus = (typeof HITO_STATUSES)[number];

/** A hito the client owes: its acta is signed or its invoice issued, not yet paid. */
export const isAwaitingPayment = (status: HitoStatus) => status === "signed" || status === "invoiced";

/** The stages of the process that a standard hito closes (PROCESS.md §2). */
export const STAGE_HITOS: Partial<Record<ObraStage, string>> = { 4: "H0", 5: "H1", 7: "H9" };
export type HitoFileKind = "acta" | "invoice";

/** Longest budget chapter or line code ("05", "05.01"); also tags photos. */
export const MAX_CHAPTER_CODE = 20;

// ─── Budget in the FRAMER model (features/budget/TECH_DESIGN.md) ─────────────
// Twenty fixed chapters (01–20, 20 = Imprevistos, computed) and, below them,
// options priced apart (OP1, OP2… with lines OP.01, OP.02…).

export const BUDGET_MODEL = "framer20";
export const BUDGET_CHAPTER_CODES = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0"));
/** Chapter 20: a share of chapters 01–19, held as one computed line. */
export const CONTINGENCY_CHAPTER = "20";
export const CONTINGENCY_LINE = "20.01";
/**
 * Lines are priced at cost; the PEC adds gastos asociados and beneficio
 * industrial on top, as % of the cost. A new budget starts from these.
 */
export const DEFAULT_MARGINS = { overheadBp: 1300, profitBp: 600 };

export const OPTION_KINDS = ["extra", "alternative", "deduction"] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

/** Where a line came from; `computed` is chapter 20's line, never edited by hand. */
export const LINE_SOURCES = ["base", "estimated", "manual", "computed"] as const;
export type LineSource = (typeof LINE_SOURCES)[number];

export const BUDGET_PDF_KINDS = ["general", "detailed"] as const;
export type BudgetPdfKind = (typeof BUDGET_PDF_KINDS)[number];

export const BUDGET_QUALITIES = ["framer", "project"] as const;
export type BudgetQuality = (typeof BUDGET_QUALITIES)[number];

/** A budget line (partida) as entered: `quantity` has up to 3 decimals. */
export type NewBudgetLine = {
  code: string;
  description: string;
  unit: string;
  quantity: number;
  unitPriceCents: number;
};

export type BudgetLine = NewBudgetLine & {
  id: string;
  amountCents: number;
  executedPct: number;
  source: LineSource;
  baseCode: string | null;
  note: string | null;
  /** The same line in every revision (its code may change). */
  lineageId: string;
};

/** A price base entry (Base de precios FRAMER 2026). */
export type PriceBaseItem = { code: string; description: string; unit: string; unitPriceCents: number };

/** What the PDFs print besides numbers. */
export type BudgetTexts = {
  cover: {
    promoter: string;
    site: string;
    cadastral: string;
    surfaces: string;
    program: string;
    basis: string;
    scope: string;
    system: string;
  };
  justification: { intro: string; blocks: { title: string; text: string }[] };
  measurementCriterion: string;
  /** "Observaciones técnicas y puntos a cerrar": the AI's inconsistencies and assumptions. */
  annex: { id: string; kind: (typeof ANNEX_KINDS)[number]; title: string; text: string }[];
  exclusions: string[];
  /** "Este presupuesto sí incluye…". */
  includes: string;
};

export type BudgetConditions = {
  validityDays: number;
  term: string;
  penalty: string;
  signingPlace: string;
};

/** An item of the "Antes de emitir" checklist (core budget-review.ts). */
/** "D. Fulano, en calidad de autopromotor…" → "D. Fulano" (the contract adds the capacity itself). */
export const promoterName = (promoter: string) => promoter.split(/,\s*en calidad de/i)[0]!.trim();

/** "OP.01–OP.04": the codes an option's (or chapter's) lines span. */
export const codeRange = (lines: { code: string }[]) =>
  lines.length === 0 ? "—" : lines.length === 1 ? lines[0]!.code : `${lines[0]!.code}–${lines[lines.length - 1]!.code}`;

/** Annex items of a budget's texts (`BudgetTexts.annex[].kind`). */
export const ANNEX_KINDS = ["inconsistency", "assumption", "note"] as const;

/** How each kind of review item is ticked off (`BudgetCheck.key`). */
export const checkKey = {
  annex: (id: string) => `annex:${id}`,
  line: (lineageId: string) => `line:${lineageId}`,
  ratio: (code: string) => `ratio:${code}`,
};

export type BudgetCheck = {
  key: string;
  kind: "inconsistency" | "assumption" | "estimated" | "ratio";
  title: string;
  detail: string;
  /** The chapter or line code it points at. */
  ref: string | null;
  /** The chapter to open for it, if any. */
  chapterCode: string | null;
  done: boolean;
  /** `ratio` checks: the chapter's €/m² built against the tenant's average (cents). */
  perM2Cents?: number;
  averageCents?: number;
};

/** How a chapter changed against the previous revision (★ up, ✦ new). */
export type ChapterChange = "up" | "down" | "new" | null;

export type BudgetChapter = {
  id: string;
  code: string;
  name: string;
  changeNote: string | null;
  /** Printed under the chapter's title in the PDFs ("Sustituye a…"). */
  pdfNote: string | null;
  /** Its lines' sum: at cost on the budget (`priceCents` adds the margins); at price in the obra. */
  totalCents: number;
  executedCents: number;
  progressPct: number;
  status: ProgressStatus;
  /** Share of the revision's total (at price), in basis points. */
  shareBp: number;
  /** The same chapter's total in the previous revision; null when it is new. */
  previousTotalCents: number | null;
  change: ChapterChange;
  /** The hito that closes this chapter, if any. */
  hitoCode: string | null;
  lines: BudgetLine[];
  /** Chapter 20 of the FRAMER model: its one line follows the others. */
  computed: boolean;
  /** Lines staff wrote (the computed one isn't). */
  lineCount: number;
  /** What it costs the client: its lines' cost plus its share of the margins. */
  priceCents: number;
  /** €/m² built at that price, in cents; null without a built area. */
  perM2Cents: number | null;
};

/** An option: priced apart from the PEC, chosen (or not) by the client on acceptance. */
export type BudgetOption = Omit<BudgetChapter, "shareBp"> & {
  optionKind: OptionKind;
  /** Alternatives: the line they replace. */
  replacesLine: string | null;
  /** Set once the revision is accepted. */
  chosen: boolean | null;
};

export type BudgetRevisionSummary = {
  id: string;
  number: number;
  status: BudgetRevisionStatus;
  /** The PEC: chapters only (01–20), never options, plus the margins. */
  totalCents: number;
  /** ISO timestamp. */
  acceptedAt: string | null;
  issuedOn: string | null;
};

export type BudgetRevision = BudgetRevisionSummary & {
  /** The chapters' lines, the computed one aside. */
  lineCount: number;
  /** The PEC per m² built, in cents. */
  perM2Cents: number | null;
  /** Chapters 01–20 at cost (ejecución material): the PEC before the margins. */
  costCents: number;
  /** Gastos asociados and beneficio industrial: % of the cost (bp) and amount. */
  overheadBp: number;
  overheadCents: number;
  profitBp: number;
  profitCents: number;
  /** Options that add to the PEC and that subtract from it (at their price). */
  optionTotals: Record<"adding" | "subtracting", { count: number; cents: number }>;
  reference: string | null;
  vatRateBp: number;
  vatCents: number;
  builtAreaM2: number | null;
  usefulAreaM2: number | null;
  exclusions: string[];
  /** The revision before this one, to compare with. */
  previous: { number: number; totalCents: number } | null;
  /** Chapters of the previous revision that this one dropped. */
  removedChapters: { code: string; name: string; totalCents: number }[];
  chapters: BudgetChapter[];
  /** "framer20", or null for a budget entered before the FRAMER model (free chapters). */
  model: string | null;
  options: BudgetOption[];
  /** PEC + the price of the options the client chose (accepted revisions); the PEC otherwise. */
  contractTotalCents: number;
  contingencyBp: number;
  quality: BudgetQuality | null;
  texts: BudgetTexts;
  conditions: BudgetConditions;
  changeReason: string | null;
  validUntil: string | null;
  acceptedOn: string | null;
  acceptedBy: string | null;
  rejectedOn: string | null;
  /** The PDFs stored when it was issued (document ids). */
  pdfs: Record<BudgetPdfKind, string | null>;
  checks: BudgetCheck[];
  /** The tenant's average €/m² built per chapter code (cents), from its other budgets. */
  ratios: Record<string, number>;
  /** Lines added, removed or changed against the previous revision. */
  lineChanges: BudgetLineChange[];
};

/** A line that changed against the previous revision (the computed 20.01 aside). */
export type BudgetLineChange = {
  code: string;
  description: string;
  kind: "added" | "removed" | "changed";
  before: { quantity: number; unitPriceCents: number; amountCents: number } | null;
  after: { quantity: number; unitPriceCents: number; amountCents: number } | null;
};

export type BudgetGenerationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
/** A run still working: at most one per project. */
export const ACTIVE_GENERATION_STATUSES: BudgetGenerationStatus[] = ["queued", "running"];

/** A progress line of an AI run; the portal words it from `code` and `params`. */
export type BudgetGenerationLogEntry = {
  at: string;
  step: number;
  kind: "info" | "done" | "error";
  code: string;
  params?: Record<string, string | number>;
};

/** What the AI read from the project, for the progress screen. */
export type BudgetFacts = {
  promoter: string;
  site: string;
  architect: string;
  typology: string;
  builtAreaM2: number;
  usefulAreaM2: number;
  windows: number;
  bathrooms: number;
  bedrooms: number;
  inconsistencies: string[];
};

export type BudgetGeneration = {
  id: string;
  status: BudgetGenerationStatus;
  /** 0–5. */
  step: number;
  log: BudgetGenerationLogEntry[];
  error: string | null;
  revisionId: string | null;
  facts: BudgetFacts | null;
  createdAt: string;
};

/** GET /api/v1/projects/:id/budget: all revisions and one of them in full. */
export type ProjectBudget = {
  revisions: BudgetRevisionSummary[];
  revision: BudgetRevision | null;
  /** The newest AI run, if any. */
  generation: BudgetGeneration | null;
};

export type Hito = {
  id: string;
  code: string;
  name: string;
  pctBp: number;
  /** % × the budget's total, without VAT. */
  amountCents: number;
  vatCents: number;
  /** What the client pays: amount + VAT. */
  totalCents: number;
  scope: string;
  billingMoment: string;
  status: HitoStatus;
  /** How far its chapters are, weighted by their amounts. */
  readyPct: number;
  chapters: { code: string; name: string; totalCents: number; progressPct: number }[];
  checks: { id: string; label: string; done: boolean }[];
  /** Photos of the acta fotográfica. */
  photoIds: string[];
  /** Set while the signed acta (PDF) is uploaded. */
  actaSignedOn: string | null;
  /** Set while the invoice (PDF) is uploaded. */
  invoicedOn: string | null;
  /** 5 business days after the acta (or the invoice, without one). */
  dueOn: string | null;
  paidOn: string | null;
  paidAmountCents: number | null;
  /** When finishing its last chapter asked Administration to invoice it (Obra tab). */
  invoiceRequestedAt: string | null;
};

/** The works' calendar: from the project's start date to its completion date. */
export type ObraTerm = {
  startDate: string;
  completionDate: string;
  /** Week of the works today (1…); 0 before they start. */
  week: number;
  totalWeeks: number;
  /** Days past the completion date. */
  lateDays: number;
  /** Contract penalty for the delay so far (cl. 4ª). */
  penaltyCents: number;
};

/** GET /api/v1/projects/:id/obra: the Obra page. */
export type ProjectObra = {
  stage: ObraStage;
  /** The accepted revision, or null before one is accepted. */
  budget: {
    revisionId: string;
    number: number;
    reference: string | null;
    totalCents: number;
    vatRateBp: number;
    acceptedAt: string | null;
  } | null;
  executedCents: number;
  progressPct: number;
  paidCents: number;
  invoicedUnpaidCents: number;
  /** The rest of the price: neither paid nor invoiced. */
  toInvoiceCents: number;
  /** What the hitos' % add up to; 10 000 when the plan is complete. */
  planPctBp: number;
  term: ObraTerm | null;
  chapters: Omit<
    BudgetChapter,
    "lines" | "id" | "previousTotalCents" | "change" | "changeNote" | "pdfNote" | "computed" | "lineCount" | "perM2Cents" | "priceCents"
  >[];
  hitos: Hito[];
};

/** A phase of the app's Obra tab: the pre-construction steps, then one per hito. */
export type MobilePhase = {
  /** "pre", or the hito's code. */
  key: string;
  /** The hito's name; null for "pre" (the app names it). */
  name: string | null;
  status: ProgressStatus;
  progressPct: number;
  finishedOn: string | null;
  /** The hitos it stands for: its own, or for "pre" the ones before the works. */
  hitoIds: string[];
  chapters: { code: string; name: string; totalCents: number; progressPct: number }[];
  checks: { id: string; label: string; done: boolean }[];
  /** Newest photos of its chapters (up to 3), and how many there are. */
  photoIds: string[];
  photoCount: number;
};

/** GET /api/mobile/obra. */
export type MobileObra = {
  stage: ObraStage;
  progressPct: number;
  totalCents: number;
  vatRateBp: number;
  paidCents: number;
  term: Pick<ObraTerm, "startDate" | "completionDate" | "week" | "totalWeeks" | "lateDays"> | null;
  phases: MobilePhase[];
  /** The phase under way: the first one not done; null once all are. */
  currentPhaseKey: string | null;
  hitos: Hito[];
};

/** Error codes of the obra services (`{ error: code }` in the API). */
export type ObraError =
  | "fixed_chapters"
  | "not_issued"
  | "change_reason_required"
  | "generation_running"
  | "ai_limit_reached"
  | "too_many_pages"
  | "no_documents"
  | "missing_fields"
  | "invalid_input"
  | "invalid_stage"
  | "invalid_date"
  | "invalid_state"
  | "duplicate_code"
  | "unknown_chapter"
  | "unknown_line"
  | "unknown_supplier"
  | "supplies_only"
  | "budget_exists"
  | "draft_exists"
  | "no_budget"
  | "not_draft"
  | "not_accepted"
  | "missing_file"
  | "invalid_file_type"
  | "file_too_large"
  | "project_not_found"
  | "dependency_cycle"
  | "not_found"
  | "forbidden";

// ─── Construction control (the project's Obra tab) ───────────────────────────
// The technical follow-up of the works: each budget chapter of the contract
// (a "main budget item") moves pending → in progress → finished only by the
// actual dates staff record; finishing a hito's last chapter asks
// Administration for its invoice, once. Costs compare each line's budgeted
// cost with what was contracted (Compras). Planned dates come from the
// approved Planning baseline; without one they are simulated (`sources`), and
// the portal says so.

export const CHAPTER_STATES = ["pending", "in_progress", "finished"] as const;
export type ChapterState = (typeof CHAPTER_STATES)[number];

/** Pending → reached (all its chapters finished) → invoice requested → invoiced → collected. */
export const MILESTONE_STATES = ["pending", "reached", "requested", "invoiced", "collected"] as const;
export type MilestoneState = (typeof MILESTONE_STATES)[number];

export const ISSUE_KINDS = ["issue", "change"] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];
export const ISSUE_PARTIES = ["client", "subcontractor", "own", "other"] as const;
export type IssueParty = (typeof ISSUE_PARTIES)[number];
export const ISSUE_STATUSES = ["pending", "review", "resolved"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Planned dates: the approved Planning baseline ("live"), or simulated without one ("mock"). */
export type PlanningSource = "mock" | "live";

/** Where data owned by other modules comes from. */
export type ControlSources = { planning: PlanningSource; purchasing: "live" };

export type ControlChapter = {
  code: string;
  name: string;
  state: ChapterState;
  /** From Planning; null without the project's dates. */
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  /** Actual minus planned, in days (late > 0); null until both are known. */
  startDelayDays: number | null;
  endDelayDays: number | null;
  /** In progress past its planned end: days over it today; else null. */
  overdueDays: number | null;
  plannedDays: number | null;
  /** Finished: its actual duration in days (both ends counted); in progress: so far. */
  actualDays: number | null;
  hitoCode: string | null;
  /** Budgeted cost (never the sale price), from the accepted budget. */
  costCents: number;
  lineCount: number;
  /** Lines whose contracting is closed (nothing left to order for them). */
  contractedLines: number;
  /** Lines with something contracted but more still to order. */
  openLines: number;
  /** What its lines were contracted for so far (Compras), closed or open; null when nothing is. */
  contractedCents: number | null;
  /** The budgeted cost of the closed lines: what the deviation is measured on. */
  contractedCostCents: number;
  /** Cost − contracted over the closed lines (saving > 0), and as bp of their cost; null when none are closed. */
  deviationCents: number | null;
  deviationBp: number | null;
  openIssues: number;
  /** New in the accepted revision against the one before, not reviewed yet. */
  added: boolean;
};

/** A chapter that left the contract in a later revision, with what was recorded on it. */
export type RemovedChapter = { code: string; name: string | null; actualStart: string | null; actualEnd: string | null };

export type InvoiceRequest = {
  id: string;
  hitoId: string;
  hitoCode: string;
  chapterCode: string;
  amountCents: number;
  description: string;
  clientName: string | null;
  requestedBy: string | null;
  requestedAt: string;
};

export type ControlMilestone = {
  id: string;
  code: string;
  name: string;
  pctBp: number;
  /** The agreed amount, without VAT. */
  amountCents: number;
  chapters: { code: string; name: string; state: ChapterState }[];
  state: MilestoneState;
  invoicedCents: number;
  collectedCents: number;
  outstandingCents: number;
  invoicedOn: string | null;
  paidOn: string | null;
  /** The invoice's PDF is on the Pagos tab. */
  hasInvoice: boolean;
  request: InvoiceRequest | null;
};

export type ProgressEvent = {
  id: string;
  chapterCode: string;
  kind: "start" | "finish" | "correct_start" | "correct_finish";
  previousDate: string | null;
  newDate: string | null;
  note: string | null;
  recordedBy: string | null;
  recordedAt: string;
};

export type IssueFile = { id: string; filename: string; contentType: string; sizeBytes: number };

export type ObraIssue = {
  id: string;
  kind: IssueKind;
  number: number;
  occurredOn: string;
  chapterCode: string;
  description: string;
  party: IssueParty;
  partyName: string | null;
  costImpactCents: number | null;
  scheduleImpactDays: number | null;
  status: IssueStatus;
  files: IssueFile[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** GET /api/v1/projects/:id/obra/control: the Obra tab's summary and progress. */
export type ConstructionControl = {
  project: {
    ref: string;
    address: string;
    clientName: string | null;
    startDate: string | null;
    completionDate: string | null;
    stage: ObraStage;
  };
  budget: { revisionId: string; number: number; reference: string | null } | null;
  today: string;
  chapters: ControlChapter[];
  removedChapters: RemovedChapter[];
  /** Chapters added or removed by the accepted revision wait for staff to review them. */
  reviewPending: boolean;
  cost: {
    budgetedCents: number;
    /** Everything contracted so far, closed lines or not. */
    contractedCents: number;
    /** The budgeted cost of the closed lines: what the deviation is measured on. */
    contractedCostCents: number;
    deviationCents: number;
    deviationBp: number;
    /** Chapter 20, kept as a reserve and not tracked. */
    contingencyCents: number;
  };
  sales: {
    contractCents: number;
    invoicedCents: number;
    collectedCents: number;
    outstandingCents: number;
    toInvoiceCents: number;
  };
  milestones: ControlMilestone[];
  documentAlerts: AttentionItem[];
  /** Material orders past their expected delivery: a warning only. */
  lateDeliveries: PurchaseOrderListItem[];
  issues: ObraIssue[];
  events: (ProgressEvent & { chapterName: string | null })[];
  photos: ProjectPhoto[];
  photoCount: number;
  sources: ControlSources;
};

/** GET /api/v1/projects/:id/obra/header: what every Obra page's header and forms need, cheaply. */
export type ControlHeader = {
  ref: string;
  stage: ObraStage;
  budgetNumber: number | null;
  openIssues: number;
  /** The contract's chapters, for pickers. */
  chapters: { code: string; name: string }[];
  today: string;
};

/** GET /api/v1/projects/:id/obra/chapters/:code/control: one chapter's follow-up. */
export type ControlChapterDetail = {
  chapter: ControlChapter;
  milestone: ControlMilestone | null;
  events: ProgressEvent[];
  issues: ObraIssue[];
  photos: ProjectPhoto[];
  /** Its lines' executed %: what the client's app shows as the chapter's progress. */
  lines: { id: string; code: string; description: string; unit: string; executedPct: number }[];
  /** The orders with a line in this chapter. */
  orders: PurchaseOrderListItem[];
  today: string;
  sources: ControlSources;
};

export type CostLine = {
  id: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  costCents: number;
  /** Null: not contracted yet (never 0). */
  contractedCents: number | null;
  /** none: nothing ordered; open: more is still to order; closed: fully contracted. */
  contracting: LineContracting;
  /** The orders that contract it. */
  orders: { id: string; number: number; supplierName: string; lateDays: number | null }[];
  /** Only for a closed line: an open one never counts as a saving. */
  deviationCents: number | null;
  deviationBp: number | null;
};

/** GET /api/v1/projects/:id/obra/costs: cost control per budget line. */
export type ConstructionCosts = {
  chapters: { code: string; name: string; state: ChapterState; lines: CostLine[] }[];
  /** Material orders past their expected delivery: a warning only. */
  lateDeliveries: PurchaseOrderListItem[];
  sources: ControlSources;
};

/** An issue's attachment: photos, emails or documents, up to 4 MB each. */
export const ISSUE_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export const MAX_ISSUE_FILE_BYTES = MAX_DOCUMENT_BYTES;

/** A file's type from its name ("planos.PDF" → pdf) by `types` (extension → content type); null if not allowed. */
export function fileTypeOf(filename: string, types: Record<string, string>) {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  const contentType = types[extension];
  return contentType ? { extension, contentType } : null;
}
export const MAX_ISSUE_TEXT = 2000;

/**
 * A line's amount: quantity (in thousandths, as stored) × unit price, rounded
 * to the cent. Budget totals in SQL (core budget.ts) round the same way.
 */
export function amountCents(quantityMilli: number, unitPriceCents: number): number {
  return Math.round((quantityMilli * unitPriceCents) / 1000);
}

/** A line's amount from a quantity as entered (up to 3 decimals). */
export const lineAmountCents = (quantity: number, unitPriceCents: number) =>
  amountCents(Math.round(quantity * 1000), unitPriceCents);

// ─── Purchasing (Compras) ─────────────────────────────────────────────────────
// A project's orders of material and subcontracts, each split across budget
// lines. What they contract is the Obra tab's "contracted" amount. Staff only:
// the client's app never sees purchasing.

export const PURCHASE_KINDS = ["material", "subcontract"] as const;
export type PurchaseKind = (typeof PURCHASE_KINDS)[number];

/** Each kind's statuses in order; either may also be cancelled. */
export const PURCHASE_FLOWS = {
  material: ["pending", "ordered", "confirmed", "in_transit", "delivered"],
  subcontract: ["pending", "contracted", "finished"],
} as const;
export type PurchaseStatus = (typeof PURCHASE_FLOWS)[PurchaseKind][number] | "cancelled";

/** Every status an order of `kind` can be set to (its flow, or cancelled). */
export const statusesOf = (kind: PurchaseKind): readonly PurchaseStatus[] => [...PURCHASE_FLOWS[kind], "cancelled"];
/** The status that places an order of `kind`: ordered (material) or contracted (subcontract). */
export const placedStatus = (kind: PurchaseKind): PurchaseStatus => PURCHASE_FLOWS[kind][1];
/** The status after `status` along its kind's flow; null once completed or cancelled. */
export function nextStatus(kind: PurchaseKind, status: PurchaseStatus): PurchaseStatus | null {
  const flow: readonly PurchaseStatus[] = PURCHASE_FLOWS[kind];
  const index = flow.indexOf(status);
  return index >= 0 && index < flow.length - 1 ? flow[index + 1]! : null;
}
/** The statuses that don't contract anything. */
export const UNCONTRACTED_STATUSES = ["pending", "cancelled"] as const;
/** An order contracts its amount from ordered (material) or contracted (subcontract) on. */
export const countsAsContracted = (status: PurchaseStatus) => !(UNCONTRACTED_STATUSES as readonly string[]).includes(status);
/** Delivered or finished. */
export const isCompletedOrder = (status: PurchaseStatus) => status === "delivered" || status === "finished";
/** Contracted and not completed yet. */
export const isOpenOrder = (status: PurchaseStatus) => countsAsContracted(status) && !isCompletedOrder(status);
/** Anything not completed (or cancelled already) may be cancelled. */
export const canCancel = (status: PurchaseStatus) => status !== "cancelled" && !isCompletedOrder(status);
/** A material supplier only delivers: it never takes a subcontract. */
export const canTakeOrder = (supplier: { suppliesOnly: boolean }, kind: PurchaseKind) =>
  !(supplier.suppliesOnly && kind === "subcontract");
/** "PED-007". */
export const orderLabel = (number: number) => `PED-${String(number).padStart(3, "0")}`;

export type LineContracting = "none" | "open" | "closed";

export const MAX_ORDER_LINES = 200;

export type PurchaseOrderListItem = {
  id: string;
  projectId: string;
  projectRef: string;
  number: number;
  kind: PurchaseKind;
  subcontractorId: string;
  supplierName: string;
  suppliesOnly: boolean;
  /** The supplier's CAE status (apta for a material supplier); null where it isn't loaded (the Obra tab). */
  caeStatus: CompanyStatus | null;
  description: string;
  status: PurchaseStatus;
  orderedOn: string | null;
  expectedOn: string | null;
  workStart: string | null;
  workEnd: string | null;
  completedOn: string | null;
  /** The sum of its lines, without VAT. */
  amountCents: number;
  chapterCodes: string[];
  /** A material order past its expected delivery and not delivered: days late today. */
  lateDays: number | null;
  hasFile: boolean;
  createdAt: string;
};

export type PurchaseOrderLine = {
  id: string;
  lineageId: string;
  chapterCode: string;
  /** The budget line now; null when the accepted budget no longer has it. */
  code: string | null;
  description: string | null;
  unit: string | null;
  quantity: number | null;
  costCents: number | null;
  amountCents: number;
  closesLine: boolean;
  /** What the line's other contracted orders add to it. */
  otherCents: number;
  /** Only once the line is closed (by this order or another): cost − all its contracted. */
  deviationCents: number | null;
  deviationBp: number | null;
};

export type PurchaseOrderEvent = {
  id: string;
  /** created | status | updated | lines | file_added | file_removed */
  action: string;
  detail: Record<string, unknown>;
  note: string | null;
  by: string | null;
  at: string;
};

/** GET /api/v1/purchases/:orderId */
export type PurchaseOrderDetail = PurchaseOrderListItem & {
  notes: string | null;
  lines: PurchaseOrderLine[];
  file: { name: string; sizeBytes: number } | null;
  /** Its chapters and where they stand on the obra. */
  chapters: { code: string; name: string; state: ChapterState }[];
  createdBy: string | null;
  events: PurchaseOrderEvent[];
  /** The day it last reached each status of its flow (cancelled too). */
  reached: Partial<Record<PurchaseStatus, string>>;
  /** The accepted budget revision its lines' costs come from. */
  budgetNumber: number | null;
  today: string;
};

/** A chapter starting soon with lines nobody has ordered yet. */
export type PurchaseUpcoming = {
  code: string;
  name: string;
  state: ChapterState;
  /** Planned (the Planning baseline, else simulated). */
  plannedStart: string | null;
  uncontractedLines: number;
  uncontractedCostCents: number;
  /** Orders for it still pending, not sent. */
  pendingOrders: { id: string; number: number }[];
};

/** GET /api/v1/projects/:id/purchases: the project's Compras tab. */
export type ProjectPurchases = {
  ref: string;
  orders: PurchaseOrderListItem[];
  summary: {
    /** The contract's lines at cost, chapter 20 aside. */
    costCents: number;
    contractedCents: number;
    closedLines: number;
    /** Cost − contracted over the closed lines; null when none is closed. */
    deviationCents: number | null;
    deviationBp: number | null;
    /** The cost of the lines nothing is contracted for yet. */
    toContractCents: number;
    uncontractedLines: number;
    pendingOrders: number;
    lateDeliveries: number;
  };
  /** Chapters starting in the next `UPCOMING_DAYS` days (or started) with lines not ordered. */
  upcoming: PurchaseUpcoming[];
  today: string;
  sources: { planning: PlanningSource };
};

export const UPCOMING_DAYS = 45;

/** GET /api/v1/purchases: every order of the tenant (GET /api/v1/subcontractors/:id/purchases: one supplier's). */
export type TenantPurchases = {
  orders: PurchaseOrderListItem[];
  projects: { id: string; ref: string; address: string }[];
  summary: {
    /** Contracted this calendar year (by order date). */
    yearContractedCents: number;
    yearOrders: number;
    yearProjects: number;
    openCents: number;
    openOrders: number;
    pendingCents: number;
    pendingOrders: number;
    lateDeliveries: number;
  };
  today: string;
};

/** A budget line to order, with what is already contracted for it. */
export type PurchaseFormLine = {
  lineageId: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  costCents: number;
  /** Contracted by the project's orders (other than the one edited). */
  contractedCents: number;
  closed: boolean;
};

/** GET /api/v1/projects/:id/purchases/form: what a new (or edited) order picks from. */
export type PurchaseForm = {
  ref: string;
  nextNumber: number;
  /** With `?orderId=`: that order as it stands, to edit. */
  editing: {
    id: string;
    number: number;
    kind: PurchaseKind;
    status: PurchaseStatus;
    subcontractorId: string;
    description: string;
    orderedOn: string | null;
    expectedOn: string | null;
    workStart: string | null;
    workEnd: string | null;
    notes: string | null;
    lines: { lineageId: string; amountCents: number; closesLine: boolean }[];
  } | null;
  suppliers: {
    id: string;
    legalName: string;
    taxIdMasked: string;
    kind: SubcontractorKind;
    suppliesOnly: boolean;
    status: CompanyStatus;
    /** Mandatory CAE documents missing or expired. */
    missing: RequirementId[];
    trades: string[];
  }[];
  chapters: {
    code: string;
    name: string;
    state: ChapterState;
    plannedStart: string | null;
    plannedEnd: string | null;
    lines: PurchaseFormLine[];
  }[];
  today: string;
  sources: { planning: PlanningSource };
};

// ─── Planning (the works schedule) ───────────────────────────────────────────
// Each contract chapter's planned dates (packages/core/src/planning.ts): it
// starts after another chapter ends (plus a lag, negative to overlap), at a
// fixed day or with the works, and lasts a number of working days of the
// project's calendar. A draft is edited freely; approving it makes it the
// baseline Avance, Compras and the Obra tab measure against. A change is a new
// version with its reason; the old ones are kept. Staff only, portal only.

/** Autonomous communities whose holidays the calendar knows (ISO 3166-2:ES); none = national only. */
export const PLANNING_REGIONS = ["as", "cb", "cl", "ga", "md"] as const;
export type PlanningRegion = (typeof PLANNING_REGIONS)[number];

export type PlanningCalendar = {
  region: PlanningRegion | null;
  /** The four weeks of August off (Monday of the first full week). */
  augustClosure: boolean;
  /** 24 December to 6 January off. */
  christmasClosure: boolean;
};

export type PlanningStatus = "draft" | "approved" | "superseded";

/** How a chapter's start is set. */
export type PlanningRule = {
  /** Starts the working day after this chapter ends, plus `lagDays`; null = at `fixedStart`, else with the works. */
  after: string | null;
  lagDays: number;
  durationDays: number;
  fixedStart: string | null;
  /** Runs from the works' start to the last chapter's end (17, 18, 19). */
  spansWorks: boolean;
};

export type PlanningItemInput = PlanningRule & { code: string };

/** One chapter of a version: its rule, its dates, and where it stands on site. */
export type PlanningRow = PlanningRule & {
  code: string;
  name: string;
  hitoCode: string | null;
  /** The version's dates (a baseline's never move). */
  plannedStart: string;
  plannedEnd: string;
  /** Where it is heading now, from what Avance recorded and today. */
  forecastStart: string;
  forecastEnd: string;
  state: ChapterState;
  actualStart: string | null;
  actualEnd: string | null;
  progressPct: number;
  /** On the chain of chapters that sets the end. */
  critical: boolean;
};

export type PlanningVersionSummary = {
  id: string;
  number: number;
  status: PlanningStatus;
  reason: string | null;
  startDate: string;
  endDate: string;
  createdBy: string | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
};

/** How a plan's end compares with the contract (delay penalty: 150 €/day from day 15, capped at 5 %). */
export type PlanningCheck = {
  endDate: string;
  /** The contract's completion date; null when the project has none. */
  contractEnd: string | null;
  /** End − contract, calendar days (late > 0); null without a contract date. */
  delayDays: number | null;
  penaltyCents: number;
};

/** GET /api/v1/projects/:id/planning: the Obra tab's Planificación. */
export type ProjectPlanning = {
  ref: string;
  stage: ObraStage;
  /** The acta de inicio and contract dates on the project. */
  startDate: string | null;
  completionDate: string | null;
  baseline:
    | (PlanningVersionSummary & {
        calendar: PlanningCalendar;
        rows: PlanningRow[];
        /** Where the works are heading, from the baseline and what happened. */
        forecast: PlanningCheck;
        planned: PlanningCheck;
      })
    | null;
  draft: PlanningVersionSummary | null;
  /** The contract's chapters (chapter 20 aside), to generate a first plan from. */
  chapters: { code: string; name: string }[];
  /** Other projects with a baseline, to copy one from. */
  copyFrom: { projectId: string; ref: string }[];
  today: string;
};

/** GET /api/v1/projects/:id/planning/draft (the portal checks it against the contract as staff edit). */
export type PlanningDraft = {
  ref: string;
  version: PlanningVersionSummary;
  calendar: PlanningCalendar;
  rows: PlanningRow[];
  /** The baseline's ends by chapter, to show what the draft moves; null for a first plan. */
  baseline: { number: number; ends: Record<string, string> } | null;
  completionDate: string | null;
  contractCents: number;
  today: string;
};

/** GET /api/v1/projects/:id/planning/versions: every version, newest first, with its dates. */
export type PlanningVersions = {
  ref: string;
  versions: (PlanningVersionSummary & {
    rows: { code: string; name: string; plannedStart: string; plannedEnd: string }[];
  })[];
};

// ─── Subcontratas ─────────────────────────────────────────────────────────────
// Companies working on the tenant's obras, their workers and CAE documents
// (packages/core/src/subcontractors.ts). Staff only.

export * from "./subcontractor-rules";

import type {
  CompanyStatus,
  CompanyStatusResult,
  DocState,
  DocStatus,
  PreventionMode,
  Region,
  RequirementId,
  SubcontractorKind,
  WorkerAccess,
} from "./subcontractor-rules";

/** Error codes of the subcontractors service (`{ error: code }` in the API). */
export type SubcontractorError =
  | "missing_fields"
  | "missing_dates"
  | "missing_reason"
  | "invalid_tax_id"
  | "invalid_id_document"
  | "invalid_postal_code"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_date"
  | "invalid_number"
  | "invalid_option"
  | "invalid_requirement"
  | "invalid_chapter"
  | "permanent_exceeds_headcount"
  | "self_employed_cannot_subcontract"
  | "chain_too_deep"
  | "supplies_only"
  | "tax_id_exists"
  | "id_document_exists"
  | "not_optional"
  | "nothing_to_review"
  | "missing_file"
  | "file_too_large"
  | "invalid_file_type"
  | "project_not_found"
  | "worker_not_found"
  | "not_found"
  | "forbidden";

/** One version (uploaded file) of a document. Dates YYYY-MM-DD, timestamps ISO. */
export type SubcontractorDocVersion = {
  id: string;
  version: number;
  filename: string;
  sizeBytes: number;
  issuedAt: string | null;
  expiresAt: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  outcome: "validated" | "rejected" | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
};

/** A required document as it stands: `id` is null while nothing was ever asked or uploaded. */
export type SubcontractorDoc = {
  id: string | null;
  requirementId: RequirementId;
  workerId: string | null;
  projectId: string | null;
  status: DocStatus | null;
  state: DocState;
  daysLeft: number | null;
  issuedAt: string | null;
  expiresAt: string | null;
  notApplicableReason: string | null;
  requestedAt: string | null;
  /** The current version and who reviewed it. */
  current: SubcontractorDocVersion | null;
  /** Every version, newest first (only on a company's or worker's own page). */
  versions: SubcontractorDocVersion[];
};

/** The documents the Empresas table shows a column for. */
export const DOC_PILLARS = ["rea", "aeat", "ss", "rc", "prl"] as const;
export type DocPillar = (typeof DOC_PILLARS)[number];

export type DocBadge = { state: DocState; daysLeft: number | null };

export type SubcontractorListItem = {
  id: string;
  kind: SubcontractorKind;
  legalName: string;
  taxIdMasked: string;
  reaRegion: Region;
  trades: string[];
  status: CompanyStatus;
  /** A material supplier: no CAE (its status is always apta). */
  suppliesOnly: boolean;
  pillars: Record<DocPillar, DocBadge>;
  /** Mandatory company documents valid, of how many. */
  docsValid: number;
  docsTotal: number;
  workers: number;
  projectIds: string[];
};

/** Something on the Empresas page that needs doing: a document, or a company's missing ones. */
export type AttentionItem = {
  subcontractorId: string;
  subcontractorName: string;
  workerId: string | null;
  workerName: string | null;
  projectId: string | null;
  projectRef: string | null;
  documentId: string | null;
  /** One document, or every missing mandatory one of a company (`state` "missing"). */
  requirementIds: RequirementId[];
  state: DocState;
  daysLeft: number | null;
  /** Expiry, upload or request date, whichever the state is about. */
  date: string | null;
  /** Workers who lose access over it (expired company documents). */
  affectedWorkers: number;
};

export type SubcontractorsOverview = {
  companies: SubcontractorListItem[];
  counts: Record<CompanyStatus, number>;
  workers: { total: number; ok: number; pending: number; blocked: number };
  /** Documents (of companies, workers and obras) expiring within their alert window, and expired. */
  expiring: number;
  expired: number;
  /** Companies working today on obras in execution, and their workers with access there. */
  onSiteToday: { projectRefs: string[]; companies: number; workers: number; blocked: string[] };
  attention: AttentionItem[];
  projects: ProjectOption[];
};

/** The rail's badges. */
export type SubcontractorCounts = { companies: number; workers: number; expiries: number };

/** An obra a company can be assigned to, with the chapters of its budget. */
export type ProjectOption = {
  id: string;
  ref: string;
  address: string;
  obraStage: number;
  chapters: { code: string; name: string }[];
};

export type SubcontractorAssignment = {
  projectId: string;
  projectRef: string;
  projectAddress: string;
  chapterCodes: string[];
  plannedStart: string | null;
  plannedEnd: string | null;
  bookOrder: number | null;
  bookDate: string | null;
  cssInformed: boolean;
  pssAdhesion: SubcontractorDoc;
  /** Its workers' access on this obra. */
  workers: { ok: number; pending: number; blocked: number };
};

export type SubcontractorAuditEntry = {
  id: string;
  at: string;
  action: string;
  userName: string | null;
  workerName: string | null;
  detail: Record<string, unknown>;
};

/** Editable company fields, as a create/update body takes them. */
export type SubcontractorFields = {
  kind: SubcontractorKind;
  legalName: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  reaNumber: string | null;
  phone: string | null;
  email: string | null;
  legalRep: string | null;
  siteContact: string | null;
  siteContactPhone: string | null;
  trades: string[];
  isInstaller: boolean;
  installerReg: string | null;
  headcount: number | null;
  permanentCount: number | null;
  subcontractsFurther: boolean;
  chainLevel: number;
  preventionMode: PreventionMode | null;
  preventionEntity: string | null;
  preventionValidUntil: string | null;
  machinery: string[];
  /** A material supplier: it only delivers, so no CAE documents, workers or obra assignments. */
  suppliesOnly: boolean;
};

/** `taxId` is in full for admins and managers, masked for viewers. */
export type SubcontractorDetail = SubcontractorFields & {
  id: string;
  reaRegion: Region;
  status: CompanyStatusResult;
  lowPermanentShare: boolean | null;
  /** Its own documents: the mandatory ones, then the optional ones. */
  documents: SubcontractorDoc[];
  assignments: SubcontractorAssignment[];
  workers: WorkerListItem[];
  history: SubcontractorAuditEntry[];
  canManage: boolean;
};

export type WorkerListItem = {
  id: string;
  subcontractorId: string;
  subcontractorName: string;
  subcontractorKind: SubcontractorKind;
  firstName: string;
  surnames: string;
  idDocumentMasked: string;
  trade: string | null;
  category: string | null;
  roles: string[];
  /** Each of the worker's documents' state. */
  docs: Partial<Record<RequirementId, DocBadge>>;
  access: WorkerAccess;
};

/** Editable worker fields. */
export type WorkerFields = {
  subcontractorId: string;
  firstName: string;
  surnames: string;
  idDocument: string;
  phone: string | null;
  category: string | null;
  trade: string | null;
  ssNumber: string | null;
  contractType: string | null;
  startDate: string | null;
  tpcNumber: string | null;
  roles: string[];
  ppeItems: string[];
};

/** An obra a worker's company is on, with what the access rules need of it. */
export type WorkerObra = {
  projectId: string;
  projectRef: string;
  chapterCodes: string[];
  pssAdhesion: { status: DocStatus; expiresAt: string | null } | null;
  bookEntry: boolean;
  access: WorkerAccess;
};

/** `idDocument` is in full for admins and managers, masked for viewers. */
export type WorkerDetail = WorkerFields & {
  id: string;
  subcontractorName: string;
  subcontractorKind: SubcontractorKind;
  companyStatus: CompanyStatus;
  documents: SubcontractorDoc[];
  /** Access anywhere (company and own documents), then on each of the company's obras. */
  access: WorkerAccess;
  obras: WorkerObra[];
  canManage: boolean;
};

/** "Comprobar acceso": who a DNI/NIE or TPC number belongs to and whether they may enter. */
export type AccessCheckResult = {
  worker: { id: string; name: string; subcontractorName: string } | null;
  access: WorkerAccess | null;
};

