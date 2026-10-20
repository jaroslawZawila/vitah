import { and, db, eq, purchaseInvoices, purchaseOrders } from "@repo/db";
import type { Ctx } from "../context";
import { addDays, todayInSpain } from "../obra-calc";
import * as invoicesService from "../purchase-invoices";
import * as purchasing from "../purchasing";

// `pnpm db:seed`: the suppliers' invoices and payments of the dev project
// VTH-26-001, after its orders. The structure's subcontract has a payment
// schedule of three milestones with a 5 % retention: the first paid, the
// second part paid and due in three days, the third not invoiced yet. Every
// other completed order is invoiced and paid by its due date, one paid
// invoice with a credit note; the first material order placed has an invoice
// four days past due.

const earlier = (a: string, b: string) => (a < b ? a : b);

/** "MSN" for Montajes Steel Norte S.L. */
const prefix = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-ZÁÉÍÓÚ]/.test(w) && !/^S\.?L|^S\.?A/.test(w))
    .map((w) => w[0])
    .join("")
    .slice(0, 3) || "PRV";

/** Seeds the project's invoices once; returns how many it created. */
export async function seedPurchaseInvoices(ctx: Ctx, projectId: string) {
  const [existing] = await db
    .select({ id: purchaseInvoices.id })
    .from(purchaseInvoices)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseInvoices.orderId))
    .where(and(eq(purchaseOrders.projectId, projectId), eq(purchaseInvoices.tenantId, ctx.tenantId)))
    .limit(1);
  if (existing) return 0;

  const today = todayInSpain();
  const { orders } = await purchasing.getProjectPurchases(ctx, projectId);
  // Oldest first, so the numbers run in order.
  const placed = orders.filter((o) => o.orderedOn && o.status !== "pending" && o.status !== "cancelled").reverse();
  const counters = new Map<string, number>();
  const nextNumber = (supplierName: string) => {
    const n = (counters.get(supplierName) ?? 100) + 7;
    counters.set(supplierName, n);
    return `${prefix(supplierName)}-2026/${n}`;
  };
  let made = 0;
  const invoice = async (orderId: string, supplierName: string, input: Record<string, unknown>) => {
    made++;
    return invoicesService.createInvoice(ctx, orderId, { number: nextNumber(supplierName), ...input });
  };
  const payInFull = async (invoiceId: string, paidOn: string) => {
    const { payableLeftCents, retainedCents } = await invoicesService.getInvoice(ctx, invoiceId);
    await invoicesService.createPayment(ctx, invoiceId, { amountCents: payableLeftCents - retainedCents, paidOn, reference: "Transferencia" });
  };

  // The structure: three milestones, the first paid, the second part paid and due soon.
  const structure = placed.find((o) => o.kind === "subcontract" && o.chapterCodes.includes("03"));
  if (structure) {
    await purchasing.updatePurchase(ctx, structure.id, { retentionBp: 500 });
    const first = Math.round(structure.amountCents * 0.345);
    await invoicesService.setOrderMilestones(ctx, structure.id, {
      milestones: [
        { concept: "Inicio de fabricación", amountCents: first },
        { concept: "Entrega en obra", amountCents: first },
        { concept: "Fin de montaje", amountCents: structure.amountCents - 2 * first },
      ],
    });
    const { milestones } = await purchasing.getPurchase(ctx, structure.id);
    const firstOn = earlier(addDays(structure.orderedOn!, 7), addDays(today, -60));
    const one = await invoice(structure.id, structure.supplierName, {
      issuedOn: firstOn,
      baseCents: first,
      milestoneId: milestones[0]!.id,
    });
    await payInFull(one.invoiceId, addDays(firstOn, 25));
    const two = await invoice(structure.id, structure.supplierName, {
      issuedOn: addDays(today, -27),
      baseCents: first,
      milestoneId: milestones[1]!.id,
    });
    await invoicesService.createPayment(ctx, two.invoiceId, { amountCents: Math.round(first / 2), paidOn: addDays(today, -4) });
  }

  // A material order invoiced on placing it, four days past due.
  const material = placed.find((o) => o.kind === "material");
  if (material) await invoice(material.id, material.supplierName, { issuedOn: addDays(today, -34), baseCents: material.amountCents });

  // The completed orders: invoiced when done and paid when due; one credit note.
  let creditSeeded = false;
  for (const order of placed) {
    if (order.id === structure?.id || order.id === material?.id || !order.completedOn) continue;
    const issuedOn = earlier(order.completedOn, today);
    const { invoiceId } = await invoice(order.id, order.supplierName, { issuedOn, baseCents: order.amountCents });
    const dueOn = addDays(issuedOn, 30);
    if (dueOn <= today) await payInFull(invoiceId, dueOn);
    if (!creditSeeded && dueOn <= today) {
      creditSeeded = true;
      await invoice(order.id, order.supplierName, {
        kind: "credit_note",
        rectifiesId: invoiceId,
        issuedOn: earlier(addDays(issuedOn, 10), today),
        baseCents: -Math.round(order.amountCents * 0.02),
        notes: "Abono por material sobrante devuelto",
      });
    }
  }
  return made;
}
