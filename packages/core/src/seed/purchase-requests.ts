import { db, eq, purchaseRequests } from "@repo/db";
import type { Ctx } from "../context";
import { addDays, todayInSpain } from "../obra-calc";
import * as requests from "../purchase-requests";
import * as purchasing from "../purchasing";

// `pnpm db:seed`: the purchase requests of the dev project VTH-26-001, after
// its orders: on chapters with nothing contracted yet, one waiting for
// approval, one approved and still to order, one rejected.

/** Seeds the project's requests once; returns how many it created. */
export async function seedPurchaseRequests(ctx: Ctx, projectId: string) {
  const existing = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.projectId, projectId),
    columns: { id: true },
  });
  if (existing) return 0;

  const today = todayInSpain();
  const form = await purchasing.getPurchaseForm(ctx, projectId);
  const open = form.chapters
    .filter((c) => c.state === "pending")
    .map((c) => ({ chapter: c, lines: c.lines.filter((l) => l.contractedCents === 0).slice(0, 2) }))
    .filter((c) => c.lines.length > 0);
  const ask = (index: number, input: Record<string, unknown>) => {
    const pick = open[index];
    if (!pick) return null;
    return requests.createRequest(ctx, projectId, {
      kind: "material",
      ...input,
      lines: pick.lines.map((line) => ({ lineageId: line.lineageId, amountCents: Math.max(100, Math.round(line.costCents * 0.95)) })),
    });
  };

  let made = 0;
  const pending = await ask(0, {
    description: `Material del capítulo ${open[0]?.chapter.code}: ${open[0]?.chapter.name}`,
    neededBy: addDays(today, 12),
    notes: "Pedir muestras antes de cerrar el pedido.",
  });
  if (pending) made++;
  const approved = await ask(1, { kind: "subcontract", description: `Subcontrato de ${open[1]?.chapter.name}`, neededBy: addDays(today, 25) });
  if (approved) {
    made++;
    await requests.decideRequest(ctx, approved.requestId, { decision: "approve", note: "Pedir tres ofertas." });
  }
  const rejected = await ask(2, { description: `Adelantar ${open[2]?.chapter.name}`, neededBy: addDays(today, 5) });
  if (rejected) {
    made++;
    await requests.decideRequest(ctx, rejected.requestId, { decision: "reject", note: "Todavía no: se pide con su capítulo." });
  }
  return made;
}
