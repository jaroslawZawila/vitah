"use server";

// Thin portal adapters over @repo/core's supplier invoices and payments
// (packages/core/src/purchase-invoices.ts): Compras › Facturas and Pagos, an
// invoice's page and form, and an order's payment schedule.

import {
  purchaseInvoicesService as svc,
  type InvoiceListQuery,
  type OrderMilestonesInput,
  type PageQuery,
  type PurchaseInvoiceChangesInput,
} from "@repo/core";
import { fieldsWithFile } from "../../lib/api";
import { mutateDashboard, read, type ObraState } from "./run";

// ─── Reads ───────────────────────────────────────────────────────────────────

/** The tenant's invoices: the page and filters of `query` (all of them without one). */
export async function getInvoices(query: InvoiceListQuery = {}) {
  const result = await read((ctx) => svc.listInvoices(ctx, {}, query));
  return result && { invoices: result.data, canManage: result.canManage };
}

/** The payments forecast and the payments made: the page of `query` (all of them without one). */
export async function getPayments(query: PageQuery = {}) {
  const result = await read((ctx) => svc.listPayments(ctx, {}, query));
  return result && { payments: result.data, canManage: result.canManage };
}

export async function getInvoice(invoiceId: string) {
  const result = await read((ctx) => svc.getInvoice(ctx, invoiceId));
  return result && { invoice: result.data, canManage: result.canManage };
}

/** What a new invoice (on `orderId`) or `invoiceId`, edited, picks from. */
export async function getInvoiceForm(query: { orderId?: string; invoiceId?: string }) {
  const result = await read((ctx) => svc.getInvoiceForm(ctx, query));
  return result && { form: result.data, canManage: result.canManage };
}

/** The rail's Compras counts; null when they can't be read. */
export async function getPurchasingCounts() {
  return (await read((ctx) => svc.getPurchasingCounts(ctx)))?.data ?? null;
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/** `review` when it uploads a PDF: the AI's review follows. */
const write = (fn: Parameters<typeof mutateDashboard>[1], review = false) => mutateDashboard(null, fn, { review });

/**
 * Form data: `data` (the invoice as JSON, with the form's `idempotencyKey`: sent
 * twice, it is registered once) and `file` (PDF, optional). → the new invoice's id too.
 */
export async function createInvoiceAction(
  orderId: string,
  formData: FormData,
): Promise<(NonNullable<ObraState> & { invoiceId?: string }) | null> {
  let made: { invoiceId: string } | undefined;
  const state = await write(async (ctx) => {
    made = await svc.createInvoice(ctx, orderId, fieldsWithFile(formData));
  }, formData.has("file"));
  return state?.success ? { ...state, ...made } : state;
}

export async function updateInvoiceAction(invoiceId: string, input: PurchaseInvoiceChangesInput): Promise<ObraState> {
  return write((ctx) => svc.updateInvoice(ctx, invoiceId, input));
}

export async function deleteInvoiceAction(invoiceId: string): Promise<ObraState> {
  return write((ctx) => svc.deleteInvoice(ctx, invoiceId));
}

/** Form data: `file` (PDF) and `note` (why it replaces the last version). */
export async function addInvoiceFileAction(invoiceId: string, formData: FormData): Promise<ObraState> {
  return write((ctx) => svc.addInvoiceFile(ctx, invoiceId, Object.fromEntries(formData)), true);
}

/**
 * Form data: `data` ({ amountCents, paidOn, method, reference, idempotencyKey })
 * and `file` (the proof, optional). The form's `idempotencyKey` makes a payment
 * sent twice (a double click, a retry) one payment.
 */
export async function createPaymentAction(invoiceId: string, formData: FormData): Promise<ObraState> {
  return write((ctx) => svc.createPayment(ctx, invoiceId, fieldsWithFile(formData)), formData.has("file"));
}

export async function deletePaymentAction(paymentId: string): Promise<ObraState> {
  return write((ctx) => svc.deletePayment(ctx, paymentId));
}

/** The order's payment schedule: [{ id?, concept, amountCents }], [] to drop it. */
export async function setOrderMilestonesAction(orderId: string, milestones: OrderMilestonesInput["milestones"]): Promise<ObraState> {
  return write((ctx) => svc.setOrderMilestones(ctx, orderId, { milestones }));
}
