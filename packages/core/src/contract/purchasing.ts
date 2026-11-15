// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

import type { PageQuery, Paging } from "../paging";
import type { CompanyStatus, RequirementId, SubcontractorKind } from "../subcontractor-rules";
import type { ChapterState, PlanningSource } from "./construction";
import type { PurchaseDocumentCheck } from "./purchase-checks";
import type { OrderInvoicing, OrderMilestone, PurchaseInvoiceListItem, PurchaseOrderAmendment, PurchaseTerms, PurchaseVatKind } from "./purchase-invoices";

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
  /** Its suppliers' invoices' base, credit notes taken off (without VAT). */
  invoicedCents: number;
  /** It has documents. */
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

/** One of an order's documents (the order, the signed contract, an annex…), in versions. */
export type PurchaseOrderDocument = {
  id: string;
  title: string;
  /** Newest (current) first. */
  versions: { id: string; version: number; filename: string; sizeBytes: number; note: string | null; by: string | null; at: string }[];
  createdAt: string;
};

/** GET /api/v1/purchases/:orderId */
export type PurchaseOrderDetail = PurchaseOrderListItem & {
  notes: string | null;
  lines: PurchaseOrderLine[];
  /** Oldest first. */
  documents: PurchaseOrderDocument[];
  /** The first document's current version (kept for older clients). */
  file: { name: string; sizeBytes: number } | null;
  /** Its chapters and where they stand on the obra. */
  chapters: { code: string; name: string; state: ChapterState }[];
  createdBy: string | null;
  events: PurchaseOrderEvent[];
  /** The day it last reached each status of its flow (cancelled too). */
  reached: Partial<Record<PurchaseStatus, string>>;
  /** The accepted budget revision its lines' costs come from. */
  budgetNumber: number | null;
  /** The purchase request it was made from. */
  request: { id: string; number: number } | null;
  /** Its formal modifications, newest first; its amount is already the last one's. */
  amendments: PurchaseOrderAmendment[];
  /** What it was placed for, before any modification. */
  originalAmountCents: number;
  /** The AI's review of its documents' versions, newest first. */
  checks: PurchaseDocumentCheck[];
  /** What its invoices start from: as set on the order, else the defaults. */
  terms: PurchaseTerms;
  /** Its payment schedule; empty when invoiced freely. */
  milestones: OrderMilestone[];
  /** Its invoices and credit notes, newest first. */
  invoices: PurchaseInvoiceListItem[];
  invoicing: OrderInvoicing;
  today: string;
};

/** A chapter whose orders are due soon (or overdue) with lines nobody has ordered yet. */
export type PurchaseUpcoming = {
  code: string;
  name: string;
  state: ChapterState;
  /** Planned (the Planning baseline, else simulated). */
  plannedStart: string | null;
  /** Its suppliers' lead time, calendar days (the plan's, else the standard one). */
  leadDays: number;
  /** The day its orders must be placed by: planned start − lead time. */
  orderBy: string | null;
  /** Days past `orderBy` today; null while there is still time. */
  orderLateDays: number | null;
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
  /** Chapters to order within `UPCOMING_DAYS` days (or overdue, or started) with lines not ordered, soonest first. */
  upcoming: PurchaseUpcoming[];
  today: string;
  sources: { planning: PlanningSource };
};

/** How far ahead "Por contratar pronto" looks at the order-by dates. */
export const UPCOMING_DAYS = 30;

/** GET /api/v1/purchases: every order of the tenant (GET /api/v1/subcontractors/:id/purchases: one supplier's). */
/** How the lists group an order: open (placed, not completed), not sent yet, completed or cancelled. */
export const PURCHASE_ORDER_GROUPS = ["open", "pending", "done", "cancelled"] as const;
export type PurchaseOrderGroup = (typeof PURCHASE_ORDER_GROUPS)[number];

/** The group an order's status falls in. */
export function purchaseOrderGroup(status: PurchaseStatus): PurchaseOrderGroup {
  if (status === "pending" || status === "cancelled") return status;
  return isCompletedOrder(status) ? "done" : "open";
}

/** The orders of one supplier among those a list's filters keep. */
export type PurchaseSupplierGroup = {
  id: string;
  name: string;
  suppliesOnly: boolean;
  orders: number;
  projectRefs: string[];
  contractedCents: number;
  openCents: number;
};

/** What narrows the tenant's orders list, as a URL carries it. */
export type PurchaseListQuery = PageQuery & {
  /** all (default) | open | pending | done | cancelled */
  group?: unknown;
  projectId?: unknown;
  supplierId?: unknown;
  /** material | subcontract */
  kind?: unknown;
  /** The order's day (its order date, or the day it was created while pending), from and to. */
  from?: unknown;
  to?: unknown;
  /** Only late deliveries. */
  late?: unknown;
  /** Text in its number (PED-007), supplier, description or obra. */
  q?: unknown;
  /** "supplier": also the orders the filters keep, by supplier. */
  by?: unknown;
};

/**
 * GET /api/v1/purchases: the tenant's orders, newest first. With `?page=` /
 * `?limit=` one page of them (see `paging`); without, all of them (up to
 * `MAX_UNPAGED`; cut there, `paging.truncated` is true and `paging.total` says
 * how many there are). `?group`, `?projectId`, `?supplierId`, `?kind`, `?from`,
 * `?to` (order date), `?late=1` and `?q` narrow the list; the summary is
 * always the whole tenant's.
 */
export type TenantPurchases = {
  /** The page asked for of the orders the filters keep. */
  orders: PurchaseOrderListItem[];
  paging: Paging;
  /** How many orders the filters keep in each group (whatever group is asked for). */
  groupCounts: Record<"all" | PurchaseOrderGroup, number>;
  /** What the orders the filters keep (the group too) contract: pending and cancelled ones don't add up. */
  shownContractedCents: number;
  /** Every supplier with orders, by name: the list's supplier filter. */
  suppliers: { id: string; name: string }[];
  /** With `?by=supplier`: the orders the filters keep, by supplier, the most contracted first. */
  bySupplier?: PurchaseSupplierGroup[];
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
    /** The obras with a late delivery. */
    lateProjectRefs: string[];
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
    paymentDays: number | null;
    retentionBp: number;
    vatKind: PurchaseVatKind | null;
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
    /** The day its orders must be placed by (planned start − lead time). */
    orderBy: string | null;
    lines: PurchaseFormLine[];
  }[];
  today: string;
  sources: { planning: PlanningSource };
};
