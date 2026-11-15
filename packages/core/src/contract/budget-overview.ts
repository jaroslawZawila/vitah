// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

import type { BudgetGenerationStatus, BudgetRevisionSummary } from "./budget";
import type { ScheduleStatus } from "./planning";

// ─── Every obra's budget (the project list, GET /api/v1/budgets) ─────────

/** A budget as the project list shows it: its newest revision, else the AI's run drafting the first. */
export type BudgetState = {
  revision: Pick<BudgetRevisionSummary, "number" | "status"> | null;
  generation: { status: BudgetGenerationStatus; step: number } | null;
};

/** What an obra on the project list may need from staff, in the order the list names them. */
export const PROJECT_ATTENTION_KINDS = [
  "to_invoice",
  "collection_overdue",
  "supplier_overdue",
  "requests",
  "late_deliveries",
  "documents",
] as const;
export type ProjectAttentionKind = (typeof PROJECT_ATTENTION_KINDS)[number];

/**
 * One reason an obra needs attention, and how many: hitos to invoice (reached
 * or requested on Obra › Hitos), hitos invoiced and past their due day unpaid,
 * supplier invoices overdue (`amountCents`: what they still owe, VAT in),
 * purchase requests waiting for approval, material deliveries late, and its
 * subcontractors' CAE document warnings (`listProjectAttention`).
 */
export type ProjectAttention = { kind: ProjectAttentionKind; count: number; amountCents?: number };

/** The obra's schedule as the list shows it: `scheduleStatus`'s verdict and, when late, its headline days. */
export type ProjectSchedule = Pick<ScheduleStatus, "status" | "worst"> & { days: number | null };

/** What the project list shows of each obra besides its budget: none of it for an obra without a contract but `attention`. */
export type ProjectSignals = {
  /** Null without an accepted budget. */
  schedule: ProjectSchedule | null;
  /** The built % (Obra's figure); null without an accepted budget. */
  progressPct: number | null;
  /** Empty when nothing needs doing. */
  attention: ProjectAttention[];
};

/** An obra's newest revision as the list shows it, at the client's price (the PEC, margins in). */
export type BudgetOverviewRevision = BudgetRevisionSummary & {
  costCents: number;
  /** PEC + the options the client chose; the PEC until accepted. */
  contractTotalCents: number;
  chosenOptions: number;
  perM2Cents: number | null;
  /** Its €/m² against the tenant's average, in bp (+600 = 6 % above); null without either. */
  perM2DeltaBp: number | null;
  validUntil: string | null;
  acceptedOn: string | null;
  rejectedOn: string | null;
  /** A FRAMER draft's review checks not ticked yet; null for any other. */
  openChecks: number | null;
  /** Days from today to `validUntil` while issued (negative once past); else null. */
  daysLeft: number | null;
};

export type BudgetOverviewItem = {
  projectId: string;
  ref: string;
  address: string;
  clientName: string | null;
  /** The newest revision; null before the first. */
  revision: BudgetOverviewRevision | null;
  /** Before the first revision: the AI's newest run drafting it, if any. */
  generation: { status: BudgetGenerationStatus; step: number } | null;
  /** When the budget last changed (ISO): a line or the revision, else its AI run, else the project's creation. */
  updatedAt: string;
};

export type BudgetOverview = {
  /** Every obra of the tenant, the budget changed last first. */
  items: BudgetOverviewItem[];
  summary: {
    /** Newest revisions in draft. */
    drafts: number;
    /** Obras whose first revision the AI is drafting (the list's draft filter counts them as drafts too). */
    generating: number;
    openChecks: number;
    issued: number;
    issuedCents: number;
    /** Issued ones within BUDGET_EXPIRY_WARNING_DAYS of expiring, or past it (`expiresSoon`). */
    expiring: number;
    accepted: number;
    contractCents: number;
    /**
     * The accepted ones' average €/m² built (cents; null with none): the obras compared as a whole. Not the
     * Budget tab's per-chapter averages (`tenantRatios`: issued and accepted budgets of the other projects).
     */
    averagePerM2Cents: number | null;
    /** Obras more than BUDGET_PER_M2_WARNING_BP above it (`perM2High`). */
    aboveAverage: number;
  };
};
