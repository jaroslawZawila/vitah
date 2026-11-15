// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

// ─── Changes to the contract and the client's consent ─────────────────────────
// (core budget-approvals.ts) A revision from Rev.1 on changes the accepted
// contract: staff link the changes (CAM-) it prices and may ask the client to
// approve it in the app. The client's answer is evidence of consent; staff
// still register the acceptance.

/**
 * A request's state: pending → approved | rejected (the client), withdrawn
 * (staff), lapsed (the revision left the table: a later one was issued, or
 * staff accepted or rejected one by hand).
 */
export const BUDGET_APPROVAL_STATUSES = ["pending", "approved", "rejected", "withdrawn", "lapsed"] as const;
export type BudgetApprovalStatus = (typeof BUDGET_APPROVAL_STATUSES)[number];

/** A change (CAM-) a revision prices. */
export type LinkedChange = {
  id: string;
  number: number;
  description: string;
  occurredOn: string;
  /** The change's estimate when it was logged (cents, may subtract); null when not estimated. */
  costImpactCents: number | null;
};

/** A request to the client, as staff see it on the revision (newest first). */
export type BudgetApproval = {
  id: string;
  status: BudgetApprovalStatus;
  message: string | null;
  /** The options proposed as chosen: what the acceptance would record. */
  chosenOptionIds: string[];
  /** The contract before (the accepted revision) and after (this one with those options), without VAT. */
  beforeCents: number;
  afterCents: number;
  vatRateBp: number;
  /** The general PDF the client was shown. */
  documentId: string | null;
  /** ISO timestamps; `decidedOn` is the day in Spain the client answered. */
  askedAt: string;
  askedBy: string | null;
  decidedAt: string | null;
  decidedOn: string | null;
  /** The client who answered. */
  decidedBy: string | null;
  rejectReason: string | null;
  /** Withdrawn or lapsed: when, and the staff user whose act closed it. */
  closedAt: string | null;
  closedBy: string | null;
};

/** GET /api/mobile/approvals: the request waiting for the client on the home shown. */
export type MobileApproval = {
  id: string;
  revisionNumber: number;
  /** The budget's own number, e.g. "036/2026". */
  reference: string | null;
  /** "Motivo de la revisión". */
  changeReason: string | null;
  message: string | null;
  askedAt: string;
  /** Without VAT, as the Pagos screens show amounts; `vatRateBp` gives the VAT. */
  beforeCents: number;
  afterCents: number;
  differenceCents: number;
  vatRateBp: number;
  /** The revision's general PDF, among the client's documents. */
  documentId: string | null;
  changes: { number: number; description: string }[];
  /** The options proposed as chosen, at the client's price (may subtract). */
  options: { name: string; priceCents: number }[];
};

/** POST /api/mobile/approvals/:id/decision → the request as answered. */
export type MobileApprovalDecisionReply = { approval: { id: string; status: BudgetApprovalStatus; decidedAt: string } };

/** Error codes of the approvals (`{ error: code }` in the API), besides the obra's. */
export type ApprovalError =
  | "no_contract"
  | "no_client"
  | "no_pdf"
  | "not_newest"
  | "approval_pending"
  | "already_approved"
  | "approval_closed"
  | "not_a_change"
  | "links_frozen";
