"use server";

// Thin portal adapters over @repo/core's supplier invoices and payments
// (packages/core/src/purchase-invoices.ts): Compras › Facturas and Pagos, an
// invoice's page and form, and an order's payment schedule.

import { purchaseInvoicesService as svc } from "@repo/core";
import { fieldsWithFile } from "../../lib/api";
import { mutateDashboard, read, type ObraState } from "./run";

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function getInvoices() {
  const result = await read((ctx) => svc.listInvoices(ctx));
  return result && { invoices: result.data, canManage: result.canManage };
}

export async function getPayments() {
  const result = await read((ctx) => svc.listPayments(ctx));
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

const write = (fn: Parameters<typeof mutateDashboard>[1]) => mutateDashboard(null, fn);

/** Form data: `data` (the invoice as JSON) and `file` (PDF, optional). → the new invoice's id too. */
export async function createInvoiceAction(
  orderId: string,
  formData: FormData,
): Promise<(NonNullable<ObraState> & { invoiceId?: string }) | null> {
  let made: { invoiceId: string } | undefined;
  const state = await write(async (ctx) => {
    made = await svc.createInvoice(ctx, orderId, fieldsWithFile(formData));
  });
  return state?.success ? { ...state, ...made } : state;
}

export async function updateInvoiceAction(invoiceId: string, input: Record<string, unknown>): Promise<ObraState> {
  return write((ctx) => svc.updateInvoice(ctx, invoiceId, input));
}

export async function deleteInvoiceAction(invoiceId: string): Promise<ObraState> {
  return write((ctx) => svc.deleteInvoice(ctx, invoiceId));
}

/** Form data: `file` (PDF) and `note` (why it replaces the last version). */
export async function addInvoiceFileAction(invoiceId: string, formData: FormData): Promise<ObraState> {
  return write((ctx) => svc.addInvoiceFile(ctx, invoiceId, Object.fromEntries(formData)));
}

/** Form data: `data` ({ amountCents, paidOn, method, reference }) and `file` (the proof, optional). */
export async function createPaymentAction(invoiceId: string, formData: FormData): Promise<ObraState> {
  return write((ctx) => svc.createPayment(ctx, invoiceId, fieldsWithFile(formData)));
}

export async function deletePaymentAction(paymentId: string): Promise<ObraState> {
  return write((ctx) => svc.deletePayment(ctx, paymentId));
}

/** The order's payment schedule: [{ id?, concept, amountCents }], [] to drop it. */
export async function setOrderMilestonesAction(
  orderId: string,
  milestones: { id?: string; concept: string; amountCents: number }[],
): Promise<ObraState> {
  return write((ctx) => svc.setOrderMilestones(ctx, orderId, { milestones }));
}
