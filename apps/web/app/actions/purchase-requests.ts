"use server";

// Thin portal adapters over @repo/core's purchase requests
// (packages/core/src/purchase-requests.ts): Compras › Solicitudes, the
// project's Solicitudes view and a request's page and form.

import {
  canDecideRequest,
  purchaseRequestsService as svc,
  type PurchaseRequestCancelInput,
  type PurchaseRequestChangesInput,
  type PurchaseRequestDecisionInput,
  type PurchaseRequestInput,
} from "@repo/core";
import { mutateDashboard, read, type ObraState } from "./run";

// ─── Reads ───────────────────────────────────────────────────────────────────

/** The tenant's requests, or one project's. */
export async function getRequests(projectId?: string) {
  const result = await read((ctx) => svc.listRequests(ctx, { projectId }));
  return result && { requests: result.data, canManage: result.canManage };
}

/** One request, and whether the caller may approve or reject it (admins). */
export async function getRequest(requestId: string) {
  const result = await read(async (ctx) => ({ request: await svc.getRequest(ctx, requestId), canDecide: canDecideRequest(ctx.role) }));
  return result && { ...result.data, canManage: result.canManage };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

const write = (fn: Parameters<typeof mutateDashboard>[1]) => mutateDashboard(null, fn);

/** → the new request's id and number too. With the form's `idempotencyKey` in `input`, sent twice it is one request. */
export async function createRequestAction(
  projectId: string,
  input: PurchaseRequestInput,
): Promise<(NonNullable<ObraState> & { requestId?: string; number?: number }) | null> {
  let made: { requestId: string; number: number } | undefined;
  const state = await write(async (ctx) => {
    made = await svc.createRequest(ctx, projectId, input);
  });
  return state?.success ? { ...state, ...made } : state;
}

export async function updateRequestAction(requestId: string, input: PurchaseRequestChangesInput): Promise<ObraState> {
  return write((ctx) => svc.updateRequest(ctx, requestId, input));
}

/** { decision: "approve" | "reject", note? }: admins only. */
export async function decideRequestAction(requestId: string, input: PurchaseRequestDecisionInput): Promise<ObraState> {
  return write((ctx) => svc.decideRequest(ctx, requestId, input));
}

export async function cancelRequestAction(requestId: string, input: PurchaseRequestCancelInput = {}): Promise<ObraState> {
  return write((ctx) => svc.cancelRequest(ctx, requestId, input));
}
