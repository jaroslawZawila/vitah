// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

import type { PageQuery, Paging } from "../paging";
import type { SubcontractorKind } from "../subcontractor-rules";
import type { ChapterState, PlanningSource } from "./construction";
import type { PurchaseDocumentCheck } from "./purchase-checks";
import { countsAsContracted, type LineContracting, type ProjectPurchases, type PurchaseKind, type PurchaseOrderEvent, type PurchaseStatus } from "./purchasing";

// ─── Supplier invoices and payments (Compras) ────────────────────────────────
// Administration registers each supplier's invoice once, against its order
// (and the order's payment milestone, when it has a schedule), then the
// payments. The obra reads them by budget line: what is invoiced, paid, owed
// and held back, without VAT. Staff only, portal only.

export const PURCHASE_VAT_KINDS = ["vat21", "vat10", "reverse_charge", "exempt"] as const;
export type PurchaseVatKind = (typeof PURCHASE_VAT_KINDS)[number];
/** Each VAT kind's rate, in basis points. */
export const VAT_RATE_BP: Record<PurchaseVatKind, number> = { vat21: 2100, vat10: 1000, reverse_charge: 0, exempt: 0 };
/** An order's invoices' VAT unless it says otherwise: a subcontract between contractors is reverse-charged (art. 84 LIVA). */
export const defaultVatKind = (kind: PurchaseKind): PurchaseVatKind => (kind === "subcontract" ? "reverse_charge" : "vat21");
/** Days to pay an invoice when its order doesn't say (Ley 3/2004's default). */
export const DEFAULT_PAYMENT_DAYS = 30;
export const MAX_PAYMENT_DAYS = 365;
/** An invoice due within this many days is due soon. */
export const DUE_SOON_DAYS = 7;
/** How far ahead the payments forecast looks. */
export const PAYMENT_FORECAST_DAYS = 30;
export const MAX_RETENTION_BP = 2000;
export const MAX_IRPF_BP = 2500;
export const MAX_MILESTONES = 20;

export const PURCHASE_INVOICE_KINDS = ["invoice", "credit_note"] as const;
export type PurchaseInvoiceKind = (typeof PURCHASE_INVOICE_KINDS)[number];
export const PURCHASE_PAYMENT_METHODS = ["transfer", "confirming", "promissory_note", "direct_debit"] as const;
export type PurchasePaymentMethod = (typeof PURCHASE_PAYMENT_METHODS)[number];

/**
 * An invoice's state, by what is owed on it: nothing yet paid, part paid,
 * past its due date with something owed, or paid (its retention may still be
 * held). A credit note settles against the invoice it rectifies.
 */
export const PURCHASE_INVOICE_STATES = ["pending", "partial", "overdue", "paid", "credit"] as const;
export type PurchaseInvoiceState = (typeof PURCHASE_INVOICE_STATES)[number];

/**
 * Where a budget line (or an order's milestone) stands in purchasing:
 * nothing contracted yet; contracted, no invoice; invoiced, with something
 * still to invoice or pay; or all of it invoiced and paid (retention aside).
 */
export const PURCHASE_PROGRESS = ["to_contract", "contracted", "invoiced", "paid"] as const;
export type PurchaseProgress = (typeof PURCHASE_PROGRESS)[number];

/** What an order's invoices start from. */
export type PurchaseTerms = { paymentDays: number; retentionBp: number; vatKind: PurchaseVatKind };

/** An invoice's amounts, as invoiced; credit notes are negative. */
export type PurchaseInvoiceAmounts = {
  /** Without VAT: what is compared with the budget's cost. */
  baseCents: number;
  vatKind: PurchaseVatKind;
  vatCents: number;
  /** Income tax withheld from a self-employed supplier. */
  irpfBp: number;
  irpfCents: number;
  /** The guarantee held back. */
  retentionBp: number;
  retentionCents: number;
  /** Base + VAT − IRPF. */
  totalCents: number;
  /** Total − retention: what is due by the due date. */
  payableCents: number;
};

/** A supplier's invoice or credit note, in a list. */
export type PurchaseInvoiceListItem = PurchaseInvoiceAmounts & {
  id: string;
  kind: PurchaseInvoiceKind;
  /** The supplier's own number. */
  number: string;
  orderId: string;
  orderNumber: number;
  orderDescription: string;
  projectId: string;
  projectRef: string;
  subcontractorId: string;
  supplierName: string;
  milestoneId: string | null;
  milestoneConcept: string | null;
  /** A credit note's invoice. */
  rectifiesId: string | null;
  rectifiesNumber: string | null;
  issuedOn: string;
  /** None for a credit note. */
  dueOn: string | null;
  /** Paid against it so far (a credit note: 0). */
  paidCents: number;
  /** Still owed by its due date, net of its credit notes; negative: in our favour. A credit note: 0. */
  outstandingCents: number;
  /** Retention still held back. */
  retainedCents: number;
  state: PurchaseInvoiceState;
  /** Days past its due date while something is owed. */
  overdueDays: number | null;
  hasFile: boolean;
  createdAt: string;
};

export type PurchasePayment = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  orderId: string;
  projectId: string;
  projectRef: string;
  supplierName: string;
  paidOn: string;
  amountCents: number;
  method: PurchasePaymentMethod;
  reference: string | null;
  file: { name: string; sizeBytes: number } | null;
  by: string | null;
  createdAt: string;
};

/** GET /api/v1/purchases/invoices/:invoiceId */
export type PurchaseInvoiceDetail = PurchaseInvoiceListItem & {
  notes: string | null;
  projectAddress: string;
  orderKind: PurchaseKind;
  supplierKind: SubcontractorKind;
  /** How its base splits across the budget's lines. */
  lines: { lineageId: string; chapterCode: string; code: string | null; description: string | null; amountCents: number }[];
  /** The credit notes rectifying it. */
  creditNotes: PurchaseInvoiceListItem[];
  /** Newest first. */
  payments: PurchasePayment[];
  /** Its PDF's versions, newest (current) first. */
  files: { id: string; version: number; filename: string; sizeBytes: number; note: string | null; by: string | null; at: string }[];
  /** The AI's review of its PDFs and of its payments' proofs, newest first. */
  checks: PurchaseDocumentCheck[];
  /** What may still be paid: the amount due, then the retention once released. */
  payableLeftCents: number;
  createdBy: string | null;
  /** Its history (in its order's log). */
  events: PurchaseOrderEvent[];
  today: string;
};

/** Money of an order or a line, without VAT: invoiced (credit notes off), then how that stands. */
export type PurchaseInvoicing = {
  invoicedCents: number;
  paidCents: number;
  /** Still owed, due or not. */
  outstandingCents: number;
  /** Held back until the guarantee ends. */
  retainedCents: number;
};

export type OrderInvoicing = PurchaseInvoicing & {
  /** The order's amount not invoiced yet. */
  toInvoiceCents: number;
};

/** A shape of an order line, before or after a change. */
export type PurchaseLineShape = { amountCents: number; closesLine: boolean };

/** An order's modification (modificado nº N): its lines' changes, signed on a day for a reason. */
export type PurchaseOrderAmendment = {
  id: string;
  number: number;
  concept: string;
  signedOn: string;
  amountBeforeCents: number;
  amountAfterCents: number;
  /** Added (from null), removed (to null) or changed lines; `code` as in the budget then. */
  changes: { code: string | null; lineageId: string; from: PurchaseLineShape | null; to: PurchaseLineShape | null }[];
  /** Its signed PDF: one of the order's documents. */
  document: { id: string; title: string } | null;
  by: string | null;
  at: string;
};

/** Whether an order may be modified: placed, not cancelled (a pending one is just edited). */
export const canAmend = (status: PurchaseStatus) => countsAsContracted(status);

/** A step of an order's payment schedule. */
export type OrderMilestone = PurchaseInvoicing & {
  id: string;
  position: number;
  concept: string;
  amountCents: number;
  progress: Exclude<PurchaseProgress, "to_contract">;
  /** Its invoices (credit notes go with theirs). */
  invoices: { id: string; number: string; state: PurchaseInvoiceState; issuedOn: string; dueOn: string | null }[];
};

/** An order seen from one of its budget lines, on the obra's Compras by line. */
export type PurchaseLineOrder = {
  id: string;
  number: number;
  kind: PurchaseKind;
  status: PurchaseStatus;
  supplierName: string;
  description: string;
  /** What it contracts of this line. */
  lineAmountCents: number;
  amountCents: number;
  expectedOn: string | null;
  completedOn: string | null;
  lateDays: number | null;
  retentionBp: number;
  /** The whole order's schedule and invoices: a milestone is the contract's, not the line's. */
  milestones: OrderMilestone[];
  invoices: PurchaseInvoiceListItem[];
  invoicing: OrderInvoicing;
};

export type PurchaseLineItem = PurchaseInvoicing & {
  lineageId: string;
  code: string;
  description: string;
  costCents: number;
  contractedCents: number;
  contracting: LineContracting;
  /** Only once closed: cost − contracted. */
  deviationCents: number | null;
  deviationBp: number | null;
  /** Its cost not contracted yet while it is open or not ordered. */
  uncontractedCents: number;
  progress: PurchaseProgress;
  /** One of its invoices is past due with something owed. */
  overdue: boolean;
  orders: PurchaseLineOrder[];
};

/** GET /api/v1/projects/:id/purchases/lines: the obra's Compras by budget line. */
export type ProjectPurchaseLines = {
  ref: string;
  summary: ProjectPurchases["summary"] &
    PurchaseInvoicing & {
      /** Owed on invoices past due. */
      overdueCents: number;
      invoices: number;
      creditNotes: number;
    };
  /** Lines by progress, for the filter. */
  counts: Record<PurchaseProgress, number>;
  /** The obra's invoices overdue or due within `DUE_SOON_DAYS`, soonest first. */
  dueAlerts: PurchaseInvoiceListItem[];
  chapters: {
    code: string;
    name: string;
    /** From Avance's dates. */
    state: ChapterState;
    costCents: number;
    contractedCents: number;
    deviationCents: number | null;
    lines: PurchaseLineItem[];
  }[];
  today: string;
  sources: { planning: PlanningSource };
};

/** GET /api/v1/purchases/invoices: the tenant's invoices (`?projectId`, `?subcontractorId`). */
/** How the invoices list groups them: owed (pending, part paid or past due), past due, paid, credit notes. */
export const PURCHASE_INVOICE_GROUPS = ["open", "overdue", "paid", "credit"] as const;
export type PurchaseInvoiceGroup = (typeof PURCHASE_INVOICE_GROUPS)[number];

/** What narrows the invoices list (never its summary), as a URL carries it. */
export type InvoiceListQuery = PageQuery & {
  /** all (default) | open | overdue | paid | credit */
  group?: unknown;
  projectId?: unknown;
  supplierId?: unknown;
  /** Text in its number, supplier, order (PED-007 or its description) or obra. */
  q?: unknown;
};

/**
 * GET /api/v1/purchases/invoices: with `?page=` / `?limit=` one page of the
 * invoices (see `paging`); without, all of them (up to `MAX_UNPAGED`).
 * `?group` and `?q` narrow the list; the summary is that of every invoice of
 * the tenant (or of `?projectId` / `?subcontractorId`).
 */
export type TenantInvoices = {
  /** The page asked for of the invoices the filters keep, owed first. */
  invoices: PurchaseInvoiceListItem[];
  paging: Paging;
  /** How many invoices the filters keep in each group (whatever group is asked for). */
  groupCounts: Record<"all" | PurchaseInvoiceGroup, number>;
  /** Every supplier with invoices, by name: the list's supplier filter. */
  suppliers: { id: string; name: string }[];
  projects: { id: string; ref: string; address: string }[];
  summary: {
    outstandingCents: number;
    outstandingInvoices: number;
    outstandingSuppliers: number;
    overdueCents: number;
    overdueInvoices: number;
    /** Due within `DUE_SOON_DAYS` days, not past due. */
    dueSoonCents: number;
    dueSoonInvoices: number;
    paidThisMonthCents: number;
    paymentsThisMonth: number;
  };
  today: string;
};

/** GET /api/v1/purchases/payments: what is owed by due week, and the payments made. */
export type TenantPayments = {
  /** What is owed: past due first (`from` null), then 7-day weeks from today over `PAYMENT_FORECAST_DAYS`. */
  forecast: { from: string | null; to: string; totalCents: number; invoices: PurchaseInvoiceListItem[] }[];
  /** Newest first: the page asked for (`?page=` / `?limit=`), else all of them (up to `MAX_UNPAGED`). */
  payments: PurchasePayment[];
  paging: Paging;
  summary: { monthCents: number; monthPayments: number };
  today: string;
};
