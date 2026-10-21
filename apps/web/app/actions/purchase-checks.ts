"use server";

// Thin portal adapters over @repo/core's review of purchase documents
// (packages/core/src/purchase-document-checks.ts): ask again, mark as seen.

import { purchaseChecksService as svc } from "@repo/core";
import { mutateDashboard, type ObraState } from "./run";

/** The file is reviewed again, after the response. */
export async function recheckDocumentAction(checkId: string): Promise<ObraState> {
  return mutateDashboard(null, (ctx) => svc.recheckDocument(ctx, checkId), { review: true });
}

export async function dismissCheckAction(checkId: string): Promise<ObraState> {
  return mutateDashboard(null, (ctx) => svc.dismissCheck(ctx, checkId));
}
