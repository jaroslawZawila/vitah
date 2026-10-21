"use server";

// Thin portal adapters over @repo/core's purchasing (packages/core/src/purchasing.ts):
// the project's Compras tab, the company-wide Compras list and an order's page.

import { purchaseAmendmentsService as amendments, purchaseDocumentsService as documents, purchasingService as svc } from "@repo/core";
import { fieldsWithFile } from "../../lib/api";
import { mutateDashboard, read, type ObraState } from "./run";

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Every order of the tenant, for Administration. */
export async function getPurchases() {
  const result = await read((ctx) => svc.listPurchases(ctx));
  return result && { purchases: result.data, canManage: result.canManage };
}

/** One supplier's orders, for its Subcontratas ficha; [] when it can't be read. */
export async function getSupplierOrders(subcontractorId: string) {
  return (await read((ctx) => svc.listSupplierOrders(ctx, subcontractorId)))?.data ?? [];
}

export async function getProjectPurchases(projectId: string) {
  const result = await read((ctx) => svc.getProjectPurchases(ctx, projectId));
  return result && { purchases: result.data, canManage: result.canManage };
}

/** The project's Compras by budget line: each line's state, its orders, milestones and invoices. */
export async function getProjectPurchaseLines(projectId: string) {
  const result = await read((ctx) => svc.getProjectPurchaseLines(ctx, projectId));
  return result && { lines: result.data, canManage: result.canManage };
}

/** What a new order (or `orderId`, edited) picks from. */
export async function getPurchaseForm(projectId: string, orderId?: string) {
  const result = await read((ctx) => svc.getPurchaseForm(ctx, projectId, orderId));
  return result && { form: result.data, canManage: result.canManage };
}

export async function getPurchase(orderId: string) {
  const result = await read((ctx) => svc.getPurchase(ctx, orderId));
  return result && { order: result.data, canManage: result.canManage };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/** Refreshes the project's tabs too. */
const write = (projectId: string, fn: Parameters<typeof mutateDashboard>[1]) => mutateDashboard(projectId, fn);

/** → the new order's id and number too. */
export async function createPurchaseAction(
  projectId: string,
  input: Record<string, unknown>,
): Promise<(NonNullable<ObraState> & { orderId?: string; number?: number }) | null> {
  let made: { orderId: string; number: number } | undefined;
  const state = await write(projectId, async (ctx) => {
    made = await svc.createPurchase(ctx, projectId, input);
  });
  return state?.success ? { ...state, ...made } : state;
}

export async function updatePurchaseAction(projectId: string, orderId: string, input: Record<string, unknown>): Promise<ObraState> {
  return write(projectId, (ctx) => svc.updatePurchase(ctx, orderId, input));
}

/** { status, date?, note? } */
export async function setPurchaseStatusAction(
  projectId: string,
  orderId: string,
  input: { status: string; date?: string | null; note?: string },
): Promise<ObraState> {
  return write(projectId, (ctx) => svc.setPurchaseStatus(ctx, orderId, input));
}

/** Form data: `title`, `file` (PDF) and `note`: a new document of the order. */
export async function addOrderDocumentAction(projectId: string, orderId: string, formData: FormData): Promise<ObraState> {
  return write(projectId, (ctx) => documents.addOrderDocument(ctx, orderId, Object.fromEntries(formData)));
}

/** Form data: `file` (PDF) and `note` (why it replaces the last): the document's next version. */
export async function addOrderDocumentVersionAction(
  projectId: string,
  orderId: string,
  documentId: string,
  formData: FormData,
): Promise<ObraState> {
  return write(projectId, (ctx) => documents.addOrderDocumentVersion(ctx, orderId, documentId, Object.fromEntries(formData)));
}

/**
 * Form data: `data` (the modificado as JSON) and `file` (its signed PDF,
 * optional). → its number too, and `documentFailed` when the PDF didn't go up.
 */
export async function amendPurchaseAction(
  projectId: string,
  orderId: string,
  formData: FormData,
): Promise<(NonNullable<ObraState> & { number?: number; documentFailed?: boolean }) | null> {
  let made: { number: number; documentFailed?: boolean } | undefined;
  const state = await write(projectId, async (ctx) => {
    made = await amendments.amendPurchase(ctx, orderId, fieldsWithFile(formData));
  });
  return state?.success ? { ...state, number: made?.number, ...(made?.documentFailed ? { documentFailed: true } : {}) } : state;
}

/** The document with all its versions. */
export async function deleteOrderDocumentAction(projectId: string, orderId: string, documentId: string): Promise<ObraState> {
  return write(projectId, (ctx) => documents.deleteOrderDocument(ctx, orderId, documentId));
}
