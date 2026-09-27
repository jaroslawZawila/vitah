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

export const DOCUMENT_CATEGORIES = ["contract", "plans", "certificates", "other"] as const;
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

/** A project document as listed in the portal and by /api/v1. */
export type ProjectDocument = MobileDocument & { uploadedBy: string | null };

/** Error codes of the documents service (`{ error: code }` in the API). */
export type DocumentError =
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
export type ProjectPhoto = MobilePhoto & { uploadedBy: string | null };

/** Error codes of the photos service (`{ error: code }` in the API). */
export type PhotoError =
  | "missing_file"
  | "invalid_file_type"
  | "file_too_large"
  | "project_not_found"
  | "not_found"
  | "forbidden";

// ─── Client account (app Perfil tab) ─────────────────────────────────────────

export const APP_LANGUAGES = ["es", "en"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

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

export type BudgetRevisionStatus = "draft" | "accepted" | "superseded";
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
};

/** How a chapter changed against the previous revision (★ up, ✦ new). */
export type ChapterChange = "up" | "down" | "new" | null;

export type BudgetChapter = {
  id: string;
  code: string;
  name: string;
  changeNote: string | null;
  totalCents: number;
  executedCents: number;
  progressPct: number;
  status: ProgressStatus;
  /** Share of the revision's total, in basis points. */
  shareBp: number;
  /** The same chapter's total in the previous revision; null when it is new. */
  previousTotalCents: number | null;
  change: ChapterChange;
  /** The hito that closes this chapter, if any. */
  hitoCode: string | null;
  lines: BudgetLine[];
};

export type BudgetRevisionSummary = {
  id: string;
  number: number;
  status: BudgetRevisionStatus;
  totalCents: number;
  /** ISO timestamp. */
  acceptedAt: string | null;
};

export type BudgetRevision = BudgetRevisionSummary & {
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
};

/** GET /api/v1/projects/:id/budget: all revisions and one of them in full. */
export type ProjectBudget = {
  revisions: BudgetRevisionSummary[];
  revision: BudgetRevision | null;
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
  chapters: Omit<BudgetChapter, "lines" | "id" | "previousTotalCents" | "change" | "changeNote">[];
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
  | "missing_fields"
  | "invalid_input"
  | "invalid_stage"
  | "invalid_date"
  | "duplicate_code"
  | "unknown_chapter"
  | "budget_exists"
  | "draft_exists"
  | "no_budget"
  | "not_draft"
  | "not_accepted"
  | "missing_file"
  | "invalid_file_type"
  | "file_too_large"
  | "project_not_found"
  | "not_found"
  | "forbidden";

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
