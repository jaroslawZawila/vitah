"use server";

// Thin portal adapters over @repo/core's warranty claims
// (packages/core/src/warranty.ts), behind the project's Garantía tab. The
// client sends the claims from the app (/api/mobile/warranty).

import { warrantyService as svc, type WarrantyClaimChangesInput, type WarrantyError } from "@repo/core";
import { mutate, read, type ActionState } from "./run";

export type WarrantyState = ActionState<WarrantyError>;

/** The project's hand-over, LOE periods and claims, newest first. */
export async function getProjectWarranty(projectId: string) {
  const result = await read((ctx) => svc.listClaims(ctx, projectId));
  return result && { warranty: result.data, canManage: result.canManage };
}

/** One claim with its photos and history. */
export async function getWarrantyClaim(projectId: string, claimId: string) {
  const result = await read((ctx) => svc.getClaim(ctx, projectId, claimId));
  return result && { claim: result.data, canManage: result.canManage };
}

/** Moves a claim on, sets its visit day and answers the client (who is pushed). */
export async function updateClaimAction(projectId: string, claimId: string, input: WarrantyClaimChangesInput): Promise<WarrantyState> {
  return mutate(projectId, (ctx) => svc.updateClaim(ctx, projectId, claimId, input));
}
