import { after } from "next/server";
import { purchaseChecksService, type Ctx } from "@repo/core";
import { logError } from "./log";

/**
 * After an upload in Compras: its PDF is queued for the AI's review as the
 * request answers (so the page shows it coming), and reviewed after the
 * response. Outside a request (tests, scripts) only the queueing happens.
 * A failed review is logged; it never fails the upload.
 */
export async function reviewDocuments(ctx: Ctx) {
  try {
    await purchaseChecksService.queueNewChecks(ctx);
  } catch (error) {
    // The upload is in: its review can be asked for later.
    logError("purchase.review_not_queued", error);
    return;
  }
  try {
    after(() => purchaseChecksService.runPendingChecks(ctx).catch((error: unknown) => logError("purchase.review_failed", error)));
  } catch {
    // Not in a request: nothing to run after.
  }
}

/** A route's answer once its upload is queued for the AI's review: `withContext(request, async (ctx) => reviewed(ctx, await …))`. */
export async function reviewed<T>(ctx: Ctx, result: T): Promise<T> {
  await reviewDocuments(ctx);
  return result;
}
