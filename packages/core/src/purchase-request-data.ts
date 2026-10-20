import { and, eq, purchaseRequestEvents, purchaseRequests, type SQL } from "@repo/db";
import type { Ctx } from "./context";
import type { PurchaseRequestStatus } from "./contract";
import { fail } from "./obra-data";
import type { Tx } from "./project-client";

// A purchase request's lifecycle writes, shared by ./purchase-requests and by
// ./purchasing (an order made from a request): its lock and its history.

/**
 * The tenant's request locked for this transaction (`where` narrows it, e.g.
 * to a project); `not_found`, or `invalid_state` unless it is one of `statuses`.
 */
export async function lockRequest(tx: Tx, ctx: Ctx, requestId: string, statuses: readonly PurchaseRequestStatus[], where?: SQL) {
  const [locked] = await tx
    .select()
    .from(purchaseRequests)
    .where(and(eq(purchaseRequests.id, requestId), eq(purchaseRequests.tenantId, ctx.tenantId), where))
    .for("update");
  if (!locked) fail("not_found");
  if (!statuses.includes(locked.status)) fail("invalid_state");
  return locked;
}

export async function logRequestEvent(
  run: Tx,
  ctx: Ctx,
  requestId: string,
  action: string,
  detail: Record<string, unknown>,
  note: string | null = null,
) {
  await run.insert(purchaseRequestEvents).values({ tenantId: ctx.tenantId, requestId, action, detail, note, userId: ctx.userId });
}

/**
 * In `tx`: the project's approved request becomes `ordered`, linked to the
 * order made from it; `request_not_approved` when it no longer is.
 */
export async function orderRequest(tx: Tx, ctx: Ctx, projectId: string, requestId: string, order: { id: string; number: number }) {
  const [locked] = await tx
    .select({ status: purchaseRequests.status })
    .from(purchaseRequests)
    .where(and(eq(purchaseRequests.id, requestId), eq(purchaseRequests.tenantId, ctx.tenantId), eq(purchaseRequests.projectId, projectId)))
    .for("update");
  if (!locked) fail("not_found");
  if (locked.status !== "approved") fail("request_not_approved");
  await tx.update(purchaseRequests).set({ status: "ordered", orderId: order.id }).where(eq(purchaseRequests.id, requestId));
  await logRequestEvent(tx, ctx, requestId, "ordered", { orderId: order.id, number: order.number });
}

/**
 * In `tx`, when an order is cancelled: the request it was made from (if any)
 * is approved again and unlinked, so another order can be made from it.
 */
export async function reopenRequestOf(tx: Tx, ctx: Ctx, order: { id: string; number: number }) {
  const [request] = await tx
    .update(purchaseRequests)
    .set({ status: "approved", orderId: null })
    .where(and(eq(purchaseRequests.orderId, order.id), eq(purchaseRequests.tenantId, ctx.tenantId), eq(purchaseRequests.status, "ordered")))
    .returning({ id: purchaseRequests.id });
  if (request) await logRequestEvent(tx, ctx, request.id, "reopened", { orderId: order.id, number: order.number });
}
