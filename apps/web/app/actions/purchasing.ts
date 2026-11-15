"use server";

// Thin portal adapters over @repo/core's purchasing (packages/core/src/purchasing.ts):
// the project's Compras tab, the company-wide Compras list and an order's page.

import {
  purchaseAmendmentsService as amendments,
  purchaseDocumentsService as documents,
  purchasingService as svc,
  type PurchaseListQuery,
  type PurchaseOrderChangesInput,
  type PurchaseOrderInput,
  type PurchaseStatusInput,
} from "@repo/core";
import { fieldsWithFile } from "../../lib/api";
import { mutateDashboard, read, type ObraState } from "./run";

// ─── Reads ───────────────────────────────────────────────────────────────────

/** The tenant's orders, for Administration: the page and filters of `query` (all of them without one). */
export async function getPurchases(query: PurchaseListQuery = {}) {
  const result = await read((ctx) => svc.listPurchases(ctx, query));
  return result && { purchases: result.data, canManage: result.canManage };
}

/** Every order `filters` keep, however many (never a page of them), for the CSV export; [] when they can't be read. */
export async function exportPurchases(filters: Omit<PurchaseListQuery, "page" | "limit" | "by"> = {}) {
  return (await read((ctx) => svc.listAllPurchases(ctx, filters)))?.data ?? [];
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

/** Refreshes the project's tabs too; `review` when it uploads a PDF (the AI's review follows). */
const write = (projectId: string, fn: Parameters<typeof mutateDashboard>[1], review = false) => mutateDashboard(projectId, fn, { review });

/** → the new order's id and number too. With the form's `idempotencyKey` in `input`, sent twice it is one order. */
export async function createPurchaseAction(
  projectId: string,
  input: PurchaseOrderInput,
): Promise<(NonNullable<ObraState> & { orderId?: string; number?: number }) | null> {
  let made: { orderId: string; number: number } | undefined;
  const state = await write(projectId, async (ctx) => {
    made = await svc.createPurchase(ctx, projectId, input);
  });
  return state?.success ? { ...state, ...made } : state;
}

export async function updatePurchaseAction(projectId: string, orderId: string, input: PurchaseOrderChangesInput): Promise<ObraState> {
  return write(projectId, (ctx) => svc.updatePurchase(ctx, orderId, input));
}

/** { status, date?, note? } */
export async function setPurchaseStatusAction(projectId: string, orderId: string, input: PurchaseStatusInput): Promise<ObraState> {
  return write(projectId, (ctx) => svc.setPurchaseStatus(ctx, orderId, input));
}

/** Form data: `title`, `file` (PDF) and `note`: a new document of the order. */
export async function addOrderDocumentAction(projectId: string, orderId: string, formData: FormData): Promise<ObraState> {
  return write(projectId, (ctx) => documents.addOrderDocument(ctx, orderId, Object.fromEntries(formData)), true);
}

/** Form data: `file` (PDF) and `note` (why it replaces the last): the document's next version. */
export async function addOrderDocumentVersionAction(
  projectId: string,
  orderId: string,
  documentId: string,
  formData: FormData,
): Promise<ObraState> {
  return write(projectId, (ctx) => documents.addOrderDocumentVersion(ctx, orderId, documentId, Object.fromEntries(formData)), true);
}

/**
 * Form data: `data` (the modificado as JSON, with the form's `idempotencyKey`:
 * sent twice, it is one modificado) and `file` (its signed PDF, optional).
 * → its number too, and `documentFailed` when the PDF didn't go up.
 */
export async function amendPurchaseAction(
  projectId: string,
  orderId: string,
  formData: FormData,
): Promise<(NonNullable<ObraState> & { number?: number; documentFailed?: boolean }) | null> {
  let made: { number: number; documentFailed?: boolean } | undefined;
  const state = await write(
    projectId,
    async (ctx) => {
      made = await amendments.amendPurchase(ctx, orderId, fieldsWithFile(formData));
    },
    formData.has("file"),
  );
  return state?.success ? { ...state, number: made?.number, ...(made?.documentFailed ? { documentFailed: true } : {}) } : state;
}

/** The document with all its versions. */
export async function deleteOrderDocumentAction(projectId: string, orderId: string, documentId: string): Promise<ObraState> {
  return write(projectId, (ctx) => documents.deleteOrderDocument(ctx, orderId, documentId));
}
