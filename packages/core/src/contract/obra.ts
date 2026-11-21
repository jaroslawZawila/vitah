// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

import type { BudgetChapter } from "./budget";

// ─── Obra: budget, progress and payment hitos ────────────────────────────────
// features/construction_process/PROCESS.md. Money is in euro cents; `…Pct` are
// whole percents; `…Bp` are basis points (13 % = 1300). Dates are YYYY-MM-DD.

/** Stages of the construction process, 1–8 (PROCESS.md §2). */
export const OBRA_STAGES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type ObraStage = (typeof OBRA_STAGES)[number];
/** Stage 6: the works themselves, from the acta de inicio. */
export const EXECUTION_STAGE: ObraStage = 6;
/** Stage 8: H9 paid, the home handed over. */
export const HANDED_OVER_STAGE: ObraStage = 8;

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
/**
 * The day the platform first held the evidence that opens each stage from 2
 * on (YYYY-MM-DD): the project's files registered, a budget draft, a revision
 * accepted, H0 paid, a chapter started, every chapter finished, H9 paid. The
 * stage rises to the last of them on its own (never down); staff may still
 * set it by hand.
 */
export type StageEvidence = Partial<Record<ObraStage, string>>;
export type HitoFileKind = "acta" | "invoice";

/** Longest budget chapter or line code ("05", "05.01"); also tags photos. */
export const MAX_CHAPTER_CODE = 20;

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

/** What the history keeps of an acta or invoice PDF (never where it is stored). */
export type HitoFileFacts = { date: string | null; sizeBytes: number | null };
/** What the history keeps of a payment. */
export type HitoPaymentFacts = { paidOn: string; amountCents: number | null };

/**
 * One entry of a hito's history: its acta or invoice uploaded (`previous`: the
 * one it replaced) or removed, its payment registered (`previous`: the one it
 * corrected) or cancelled. Staff-only, web-only: the client never sees it.
 */
export type HitoEvent = {
  id: string;
  /** When it was recorded (ISO). */
  at: string;
  /** Who did it; null once that user is deleted. */
  userName: string | null;
} & (
  | { action: "acta_uploaded" | "invoice_uploaded"; detail: HitoFileFacts & { previous: HitoFileFacts | null } }
  | { action: "acta_removed" | "invoice_removed"; detail: HitoFileFacts }
  | { action: "payment_registered"; detail: HitoPaymentFacts & { previous: HitoPaymentFacts | null } }
  | { action: "payment_cancelled"; detail: HitoPaymentFacts }
);
export type HitoEventAction = HitoEvent["action"];

/** GET /api/v1/projects/:id/hitos/:hitoId: the hito with its history, newest first. */
export type HitoDetail = Hito & { events: HitoEvent[] };

/** The works' calendar: from the project's start date to its completion date. */
export type ObraTerm = {
  startDate: string;
  completionDate: string;
  /** Week of the works today (1…); 0 before they start. */
  week: number;
  totalWeeks: number;
  /** Days past the completion date. */
  lateDays: number;
};

/** GET /api/v1/projects/:id/obra: the Obra page. */
export type ProjectObra = {
  stage: ObraStage;
  /** What has moved the stage on its own, by the stage it opened. */
  stageEvidence: StageEvidence;
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
  /** When its chapters are planned to be done (the approved Planning baseline); null without one, or for "pre". */
  plannedEnd: string | null;
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
  /** Between the dates the client is told: the approved plan's start and end, else the project's dates. */
  term: ObraTerm | null;
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
  | "has_invoices"
  | "has_payments"
  | "duplicate_number"
  | "milestones_mismatch"
  | "milestones_cut"
  | "exceeds_amount"
  | "request_not_approved"
  | "no_changes"
  | "below_invoiced"
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
  | "idempotency_key_reused"
  | "not_found"
  | "forbidden";
