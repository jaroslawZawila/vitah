import { and, asc, db, eq, inArray, isNotNull, max, purchaseInvoices, purchaseOrderAmendments, purchaseOrderMilestones, purchaseOrders } from "@repo/db";
import { requireEditor, type Ctx } from "./context";
import { canAmend } from "./contract";
import { requirePdf } from "./documents";
import { fail, optionalText, requiredText, workDate } from "./obra-data";
import { todayInSpain } from "./obra-calc";
import { addOrderDocument } from "./purchase-documents";
import { MAX_DESCRIPTION, contractLines, logEvent, parseLines, replaceOrderLines, requireOrder } from "./purchasing";
import type { Tx } from "./project-client";

// ─── An order's modificados (formal amendments) ──────────────────────────────
// A placed order changes formally by a modificado: numbered per order, signed
// on a day for a reason, maybe with its signed PDF. It rewrites the order's
// lines as an edit does (replaceOrderLines: invoiced lines stay, never below
// what they invoiced), keeps the amounts before and after and what changed,
// and keeps a payment schedule adding up: a rise is a new milestone, a cut
// comes off the last milestones not invoiced. A pending order is just edited.
// Staff only: admins and managers write; it shows on the order's page.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TITLE = 200;
const MAX_CONCEPT = 200;

const sum = (lines: { amountCents: number }[]) => lines.reduce((total, l) => total + l.amountCents, 0);

/**
 * The order's payment schedule, if any, follows a change of `deltaCents`: a
 * rise is a milestone of its own (`concept`), a cut comes off the last
 * milestones with no invoice; `milestones_mismatch` if those can't take it.
 */
async function followSchedule(tx: Tx, ctx: Ctx, orderId: string, deltaCents: number, concept: string) {
  if (deltaCents === 0) return;
  const milestones = await tx
    .select()
    .from(purchaseOrderMilestones)
    .where(eq(purchaseOrderMilestones.orderId, orderId))
    .orderBy(asc(purchaseOrderMilestones.position));
  if (milestones.length === 0) return;
  if (deltaCents > 0) {
    const position = Math.max(...milestones.map((m) => m.position)) + 1;
    await tx.insert(purchaseOrderMilestones).values({ tenantId: ctx.tenantId, orderId, position, concept: concept.slice(0, MAX_CONCEPT), amountCents: deltaCents });
    return;
  }
  const invoiced = await tx
    .selectDistinct({ milestoneId: purchaseInvoices.milestoneId })
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.orderId, orderId), isNotNull(purchaseInvoices.milestoneId), inArray(purchaseInvoices.milestoneId, milestones.map((m) => m.id))));
  const locked = new Set(invoiced.map((i) => i.milestoneId));
  let left = -deltaCents;
  for (const milestone of [...milestones].reverse()) {
    if (left === 0) break;
    if (locked.has(milestone.id)) continue;
    const taken = Math.min(left, milestone.amountCents);
    left -= taken;
    if (taken === milestone.amountCents) await tx.delete(purchaseOrderMilestones).where(eq(purchaseOrderMilestones.id, milestone.id));
    else await tx.update(purchaseOrderMilestones).set({ amountCents: milestone.amountCents - taken }).where(eq(purchaseOrderMilestones.id, milestone.id));
  }
  if (left > 0) fail("milestones_mismatch");
}

/**
 * Body: { concept, lines: [{ lineageId, amountCents, closesLine? }] (all of
 * the order's lines as they will be), signedOn? (from the order's date to
 * today; today by default), file? (the signed PDF), documentTitle? (its name;
 * "{n}" becomes the modificado's number; else the file's name) }.
 * → { amendmentId, number, deltaCents, documentFailed? }: the PDF goes up once
 * the modificado is in; if that fails, it stands without it.
 */
export async function amendPurchase(ctx: Ctx, orderId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const order = await requireOrder(ctx, orderId);
  if (!canAmend(order.status)) fail("invalid_state");
  const concept = requiredText(input.concept, MAX_DESCRIPTION);
  const signedOn = input.signedOn === undefined || input.signedOn === null || input.signedOn === "" ? todayInSpain() : workDate(input.signedOn);
  // Not before the contract it changes.
  if (order.orderedOn && signedOn < order.orderedOn) fail("invalid_date");
  const title = optionalText(input.documentTitle, MAX_TITLE);
  const [contract, file] = await Promise.all([
    contractLines(ctx.tenantId, order.projectId),
    input.file === undefined || input.file === null ? null : requirePdf(input.file),
  ]);
  const lines = parseLines(input.lines, contract);

  const made = await db.transaction(async (tx) => {
    // Locked: a status change, an edit or another modificado waits for this one.
    const [locked] = await tx.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, orderId)).for("update");
    if (!locked || !canAmend(locked.status)) fail("invalid_state");
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
  });

  if (!file) return made;
  const fileName = file instanceof File ? file.name.replace(/\.pdf$/i, "").slice(0, MAX_TITLE) : "";
  let documentId: string;
  try {
    ({ documentId } = await addOrderDocument(ctx, orderId, {
      title: title?.replaceAll("{n}", String(made.number)) || fileName || String(made.number),
      file,
    }));
  } catch (error) {
    console.error("Modificado PDF upload failed", error);
    return { ...made, documentFailed: true };
  }
  await db.update(purchaseOrderAmendments).set({ documentId }).where(eq(purchaseOrderAmendments.id, made.amendmentId));
  return made;
}
