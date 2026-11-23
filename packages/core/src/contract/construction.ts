// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

import { MAX_DOCUMENT_BYTES, type ProjectPhoto } from "./files";
import type { ObraStage } from "./obra";
import type { ScheduleStatus } from "./planning";
import type { LineContracting, PurchaseOrderListItem } from "./purchasing";
import type { AttentionItem } from "./subcontractors";

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
  /** Contracted − cost over the closed lines (overrun > 0, saving < 0), and as bp of their cost; null when none are closed. */
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
  /** A change's budget revisions that price it (core budget-approvals.ts), by number. */
  revisions: { id: string; number: number }[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The Obra tab's summary and progress, as the portal's pages read it. */
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
    /** The obra's current cost: its suppliers' invoices registered so far, base without VAT, credit notes off. */
    supplierInvoicedCents: number;
    /** The expected final cost: `budgetedCents` + `contingencyCents` + `deviationCents` (the closed lines' overruns and savings). */
    forecastCents: number;
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
  /** Valor global: `sales.contractCents` (margins in, without VAT) less `cost.forecastCents`, the expected margin; `bp` of the contract. */
  globalValue: { cents: number; bp: number };
  milestones: ControlMilestone[];
  documentAlerts: AttentionItem[];
  /** Material orders past their expected delivery: a warning only. */
  lateDeliveries: PurchaseOrderListItem[];
  issues: ObraIssue[];
  sources: ControlSources;
  /** On time or late: the same as GET …/planning's `schedule`. */
  schedule: ScheduleStatus;
};

/**
 * GET /api/v1/projects/:id/obra/control: the control plus the obra's latest records and photos. The portal no longer
 * shows them; the API keeps them for its clients.
 */
export type ConstructionControlResponse = ConstructionControl & {
  events: (ProgressEvent & { chapterName: string | null })[];
  photos: ProjectPhoto[];
  photoCount: number;
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
