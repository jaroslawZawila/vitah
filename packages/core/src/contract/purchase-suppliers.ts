// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

import type { CompanyStatus, SubcontractorKind } from "../subcontractor-rules";
import type { OrderInvoicing, OrderMilestone, PurchaseInvoiceDetail, PurchaseInvoiceListItem, PurchasePayment, PurchaseTerms } from "./purchase-invoices";
import type { PurchaseKind, PurchaseOrderListItem } from "./purchasing";

// ─── Suppliers (Compras › Proveedores) ───────────────────────────────────────
// Each Subcontratas company (material suppliers too) as Compras sees it:
// what it was ordered, invoiced and paid across the obras, and what is owed.
// The company's data and CAE stay on its Subcontratas ficha.

export type PurchaseSupplierItem = {
  id: string;
  legalName: string;
  kind: SubcontractorKind;
  suppliesOnly: boolean;
  /** CAE standing (a material supplier is always apta). */
  caeStatus: CompanyStatus;
  /** Orders, cancelled ones aside, and the obras they are for. */
  orders: number;
  projects: number;
  /** Placed orders (ordered / contracted on), without VAT. */
  contractedCents: number;
  /** Invoiced and paid without VAT, net of credit notes: compared with what is contracted. */
  invoicedCents: number;
  paidCents: number;
  /** Still owed on its invoices, VAT in, retention apart: what Administration pays. */
  outstandingCents: number;
  /** Of what is owed, past due. */
  overdueCents: number;
  /** Retention held back until its guarantees end. */
  retainedCents: number;
  /** Its last order's day (placed, else created; in Spain). */
  lastOrderOn: string | null;
};

/** GET /api/v1/purchases/suppliers: every supplier, those owed first. */
export type TenantSuppliers = {
  suppliers: PurchaseSupplierItem[];
  summary: {
    /** Suppliers with orders. */
    active: number;
    contractedCents: number;
    outstandingCents: number;
    overdueCents: number;
    overdueSuppliers: number;
    retainedCents: number;
  };
};

/** GET /api/v1/purchases/suppliers/:subcontractorId: one supplier's orders, invoices and payments. */
export type SupplierPurchasing = {
  supplier: PurchaseSupplierItem;
  orders: PurchaseOrderListItem[];
  /** Owed first, as Compras › Facturas. */
  invoices: PurchaseInvoiceListItem[];
  /** Newest first. */
  payments: PurchasePayment[];
  today: string;
};

/** GET /api/v1/purchases/counts: Compras' sections in the rail. */
export type PurchasingCounts = {
  /** Requests waiting for approval. */
  requests: number;
  orders: number;
  invoices: number;
  payments: number;
  /** Companies in Subcontratas: every one can be a supplier. */
  suppliers: number;
  /** Invoices overdue or due within `DUE_SOON_DAYS`: the rail's badge. */
  dueAttention: number;
};

/** GET /api/v1/purchases/invoices/form: what a new (or edited) invoice picks from. */
export type PurchaseInvoiceForm = {
  /** Orders that can be invoiced: placed, not cancelled. */
  orders: {
    id: string;
    number: number;
    projectId: string;
    projectRef: string;
    description: string;
    subcontractorId: string;
    supplierName: string;
    amountCents: number;
    invoicedCents: number;
  }[];
  /** With `?orderId=` (or editing): that order's details. */
  order: {
    id: string;
    kind: PurchaseKind;
    supplierKind: SubcontractorKind;
    amountCents: number;
    terms: PurchaseTerms;
    milestones: OrderMilestone[];
    lines: { lineageId: string; chapterCode: string; code: string | null; description: string | null; amountCents: number; invoicedCents: number }[];
    /** Its invoices a credit note may rectify. */
    invoices: PurchaseInvoiceListItem[];
    invoicing: OrderInvoicing;
  } | null;
  /** With `?invoiceId=`: that invoice as it stands, to edit. */
  editing: PurchaseInvoiceDetail | null;
  today: string;
};
