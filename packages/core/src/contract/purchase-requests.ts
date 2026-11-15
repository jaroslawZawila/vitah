// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

import type { PurchaseKind, PurchaseOrderEvent } from "./purchasing";

// ─── Purchase requests (Compras › Solicitudes) ───────────────────────────────
// What an obra asks to buy before there is an order: material or a
// subcontract for some budget lines, with an estimate and the day it is
// needed by. Admins and managers request; an admin approves or rejects it
// (with a reason); an approved request becomes an order (the order form
// opens on it). Orders may still be made without one. Staff only, portal only.

export const PURCHASE_REQUEST_STATUSES = ["pending", "approved", "rejected", "ordered", "cancelled"] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];
/** "SOL-003". */
export const requestLabel = (number: number) => `SOL-${String(number).padStart(3, "0")}`;
/** Still open (pending or approved, not ordered): it may be cancelled, and runs late past its needed-by day. */
export const isOpenRequest = (status: PurchaseRequestStatus) => status === "pending" || status === "approved";

export type PurchaseRequestListItem = {
  id: string;
  projectId: string;
  projectRef: string;
  number: number;
  kind: PurchaseKind;
  description: string;
  neededBy: string | null;
  /** The supplier the obra suggests. */
  subcontractorId: string | null;
  supplierName: string | null;
  status: PurchaseRequestStatus;
  /** The estimate: its lines summed, without VAT. */
  amountCents: number;
  chapterCodes: string[];
  createdBy: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** The order made from it. */
  order: { id: string; number: number } | null;
  /** Still to order and past its needed-by day: days late today. */
  lateDays: number | null;
};

/** GET /api/v1/purchases/requests/:requestId */
export type PurchaseRequestDetail = PurchaseRequestListItem & {
  notes: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  lines: {
    id: string;
    lineageId: string;
    chapterCode: string;
    /** The budget line now; null when the accepted budget no longer has it. */
    code: string | null;
    description: string | null;
    unit: string | null;
    quantity: number | null;
    costCents: number | null;
    /** What the project's orders already contract of it. */
    contractedCents: number;
    amountCents: number;
  }[];
  /** Shaped like an order's: created, updated, lines, plus approved / rejected / cancelled / ordered. */
  events: PurchaseOrderEvent[];
};

/** GET /api/v1/purchases/requests (`?projectId`): the requests, those to decide first. */
export type TenantRequests = {
  requests: PurchaseRequestListItem[];
  projects: { id: string; ref: string; address: string }[];
  summary: {
    pending: number;
    pendingCents: number;
    /** Approved, not ordered yet. */
    approved: number;
    approvedCents: number;
  };
};
