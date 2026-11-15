import { db, eq, max, purchaseOrderAmendments, purchaseOrderLines, purchaseOrders, sql } from "@repo/db";
import { requireEditor, type Ctx } from "./context";
import { canAmend } from "./contract";
import { requirePdf } from "./documents";
import { idempotent, type Once } from "./idempotency";
import { logError } from "./log";
import { parse } from "./inputs/fields";
import { MAX_TITLE, amendmentSchema } from "./inputs/purchase-amendments";
import { fail } from "./obra-data";
import { MAX_AMOUNT_CENTS } from "./money";
import { todayInSpain } from "./obra-calc";
import { addOrderDocument } from "./purchase-documents";
import { contractLines, contractedLines, followSchedule, logEvent, replaceOrderLines, requireOrder } from "./purchasing";

// ─── An order's modificados (formal amendments) ──────────────────────────────
// A placed order changes formally by a modificado: numbered per order, signed
// on a day for a reason, maybe with its signed PDF. It rewrites the order's
// lines as an edit does (replaceOrderLines: invoiced lines stay, never below
// what they invoiced), keeps the amounts before and after and what changed,
// and keeps a payment schedule adding up: a rise is a new milestone, a cut
// comes off the last milestones not invoiced. A pending order is just edited.
// Staff only: admins and managers write; it shows on the order's page.
// ─────────────────────────────────────────────────────────────────────────────

const sum = (lines: { amountCents: number }[]) => lines.reduce((total, l) => total + l.amountCents, 0);

type Made = { amendmentId: string; number: number; deltaCents: number };

/**
 * Body: { concept, lines: [{ lineageId, amountCents, closesLine? }] (all of
 * the order's lines as they will be), signedOn? (from the order's date to
 * today; today by default), file? (the signed PDF), documentTitle? (its name;
 * "{n}" becomes the modificado's number; else the file's name),
 * idempotencyKey? }.
 * → { amendmentId, number, deltaCents, documentFailed? }: the PDF goes up once
 * the modificado is in; if that fails, it stands without it.
 *
 * Sent again with the same `idempotencyKey` (./idempotency) it is one
 * modificado with one number, and its PDF one document: the retry answers
 * with the modificado already in and attaches the PDF only if the first call
 * didn't (the document has a key of its own, the modificado's id).
 */
export async function amendPurchase(ctx: Ctx, orderId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const made = await idempotent<Made>(ctx, "purchase.amendment.create", { orderId }, input, (once) => recordAmendment(ctx, orderId, input, once));
  // Read again here: a retry answered from its key has checked nothing.
  const { file: sent, documentTitle: title } = parse(amendmentSchema.pick({ documentTitle: true, file: true }), input);
  const file = sent === undefined || sent === null ? null : await requirePdf(sent);
  if (!file) return made;
  const fileName = file instanceof File ? file.name.replace(/\.pdf$/i, "").slice(0, MAX_TITLE) : "";
  let documentId: string;
  try {
    ({ documentId } = await addOrderDocument(
      ctx,
      orderId,
      { title: title?.replaceAll("{n}", String(made.number)) || fileName || String(made.number), file },
      // Only a request with a key can come again.
      input.idempotencyKey === undefined || input.idempotencyKey === null ? undefined : `amendment-${made.amendmentId}`,
    ));
  } catch (error) {
    logError("purchase.amendment_file_failed", error, { orderId, amendmentId: made.amendmentId });
    return { ...made, documentFailed: true };
  }
  await db.update(purchaseOrderAmendments).set({ documentId }).where(eq(purchaseOrderAmendments.id, made.amendmentId));
  return made;
}

/** Checks the modificado and records it, once per key; its PDF is the caller's. */
async function recordAmendment(ctx: Ctx, orderId: string, input: Record<string, unknown>, once: Once<Made>): Promise<Made> {
  const order = await requireOrder(ctx, orderId);
  if (!canAmend(order.status)) fail("invalid_state");
  const { concept, file, ...body } = parse(amendmentSchema.omit({ lines: true }), input);
  const signedOn = body.signedOn ?? todayInSpain();
  // Not before the contract it changes.
  if (order.orderedOn && signedOn < order.orderedOn) fail("invalid_date");
  // The PDF before the lines, as always.
  const [contract] = await Promise.all([
    contractLines(ctx.tenantId, order.projectId),
    file === undefined || file === null ? null : requirePdf(file),
  ]);
  const lines = contractedLines(parse(amendmentSchema.pick({ lines: true }), input).lines, contract);
  // The amounts before and after are stored as integers: each line fits, an order's total may not.
  if (sum(lines) > MAX_AMOUNT_CENTS) fail("invalid_input");

  return db.transaction((tx) =>
    once(tx, async () => {
      // Locked: a status change, an edit or another modificado waits for this one.
      const [locked] = await tx.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, orderId)).for("update");
      if (!locked || !canAmend(locked.status)) fail("invalid_state");
      const [current] = await tx
        .select({ cents: sql<number>`coalesce(sum(${purchaseOrderLines.amountCents}), 0)`.mapWith(Number) })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.orderId, orderId));
      if ((current?.cents ?? 0) > MAX_AMOUNT_CENTS) fail("invalid_input");
      const { before, changes } = await replaceOrderLines(tx, ctx, orderId, lines, contract);
      if (changes.length === 0) fail("no_changes");
      const [last] = await tx
        .select({ number: max(purchaseOrderAmendments.number) })
        .from(purchaseOrderAmendments)
        .where(eq(purchaseOrderAmendments.orderId, orderId));
      const number = (last?.number ?? 0) + 1;
      const amountBeforeCents = sum(before);
      const amountAfterCents = sum(lines);
      const deltaCents = amountAfterCents - amountBeforeCents;
      await followSchedule(tx, ctx, orderId, deltaCents, concept);
      const [row] = await tx
        .insert(purchaseOrderAmendments)
        .values({ tenantId: ctx.tenantId, orderId, number, concept, signedOn, amountBeforeCents, amountAfterCents, changes, createdById: ctx.userId })
        .returning({ id: purchaseOrderAmendments.id });
      await logEvent(tx, ctx, orderId, "amended", { number, concept, signedOn, deltaCents, changes });
      return { amendmentId: row!.id, number, deltaCents };
    }),
  );
}
