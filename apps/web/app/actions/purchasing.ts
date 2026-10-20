"use server";

// Thin portal adapters over @repo/core's purchasing (packages/core/src/purchasing.ts):
// the project's Compras tab, the company-wide Compras list and an order's page.

import { purchasingService as svc, type ObraError } from "@repo/core";
import { revalidatePath } from "next/cache";
import { mutate, read, type ObraState } from "./run";

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

/** Runs the write, then refreshes the project's tabs, the company-wide lists and the rail's counts. */
async function write(projectId: string, fn: Parameters<typeof mutate>[1]): Promise<ObraState> {
  const state = await mutate<ObraError>(projectId, fn);
  if (state?.success) revalidatePath("/dashboard", "layout");
  return state;
}

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

/** Form action: { file } (PDF). */
export async function uploadPurchaseFileAction(
  projectId: string,
  orderId: string,
  _prevState: ObraState,
  formData: FormData,
): Promise<ObraState> {
  return write(projectId, (ctx) => svc.uploadPurchaseFile(ctx, orderId, Object.fromEntries(formData)));
}

export async function deletePurchaseFileAction(projectId: string, orderId: string): Promise<ObraState> {
  return write(projectId, (ctx) => svc.deletePurchaseFile(ctx, orderId));
}
