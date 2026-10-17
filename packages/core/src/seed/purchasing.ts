import { db, eq, purchaseOrders, subcontractors } from "@repo/db";
import type { Ctx } from "../context";
import { isValidCif, type ControlChapter, type PurchaseForm } from "../contract";
import * as construction from "../construction";
import { addDays, todayInSpain } from "../obra-calc";
import * as purchasing from "../purchasing";
import { createSubcontractor } from "../subcontractors";

// `pnpm db:seed`: the orders of the dev project VTH-26-001, after its
// construction control and subcontractors. Each chapter built or under way is
// contracted with the company of its trade (cost give or take up to 6 %); the
// chapter in progress has a late delivery, an open line and lines still to
// order; the next chapters have orders not sent yet. Fictional material
// suppliers are added to the Subcontratas list. Dates follow the chapters'.

const cif = (stem: string) => [..."0123456789"].map((c) => stem + c).find(isValidCif)!;

const SUPPLIERS = [
  { legalName: "Piedra de Liébana S.L.", taxId: cif("B3941827"), postalCode: "39570", city: "Potes", trades: [] },
  { legalName: "Hormigones Torrelavega S.A.", taxId: cif("A3910442"), postalCode: "39300", city: "Torrelavega", trades: [] },
  { legalName: "Carpinterías Cabezón S.L.", taxId: cif("B3950118"), postalCode: "39500", city: "Cabezón de la Sal", trades: ["carpentry"] },
  { legalName: "Suministros de Obra Cantabria S.L.", taxId: cif("B3933071"), postalCode: "39011", city: "Santander", trades: [] },
];

/** The company that builds each chapter, by name (Subcontratas' seed); else the general supplier. */
const BUILDERS: Record<string, string> = {
  "01": "Excavaciones Asón S.L.",
  "02": "Excavaciones Asón S.L.",
  "03": "Montajes Steel Norte S.L.",
  "05": "Cubiertas Besaya S.L.",
  "06": "Aislamientos Cantábrico S.L.",
  "10": "Carpinterías Cabezón S.L.",
  "11": "Instalaciones Térmicas Pas S.L.",
  "12": "Instalaciones Térmicas Pas S.L.",
  "13": "Electricidad Saja S.L.",
  "14": "Electricidad Saja S.L.",
  "16": "Pinturas Miera S.L.U.",
};

/** A stable 32-bit hash (FNV-1a), for each line's spread. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A line's cost give or take up to 6 %, the same every run. */
const contracted = (lineageId: string, costCents: number) =>
  costCents + Math.round((costCents * ((hash(lineageId) % 1201) - 600)) / 10_000);

const earlier = (a: string, b: string) => (a < b ? a : b);

/** Seeds the project's orders once; returns how many it created. */
export async function seedPurchasing(ctx: Ctx, projectId: string) {
  const existing = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.projectId, projectId),
    columns: { id: true },
  });
  if (existing) return 0;

  const companies = await db
    .select({ id: subcontractors.id, legalName: subcontractors.legalName, taxId: subcontractors.taxId })
    .from(subcontractors)
    .where(eq(subcontractors.tenantId, ctx.tenantId));
  const byName = new Map(companies.map((c) => [c.legalName, c.id]));
  for (const s of SUPPLIERS) {
    if (byName.has(s.legalName) || companies.some((c) => c.taxId === s.taxId)) continue;
    const { id } = await createSubcontractor(ctx, {
      kind: "company",
      address: "Polígono Industrial, nave 2",
      phone: "942 000 000",
      suppliesOnly: true,
      ...s,
    });
    byName.set(s.legalName, id);
  }

  const today = todayInSpain();
  const [form, control] = await Promise.all([
    purchasing.getPurchaseForm(ctx, projectId),
    construction.getControl(ctx, projectId),
  ]);
  const progress = new Map(control.chapters.map((c) => [c.code, c]));
  const supplier = (code: string) => byName.get(BUILDERS[code] ?? "") ?? byName.get("Suministros de Obra Cantabria S.L.")!;
  const isSupplier = (id: string) => SUPPLIERS.some((s) => byName.get(s.legalName) === id);
  let made = 0;

  const order = async (
    chapter: PurchaseForm["chapters"][number],
    lines: PurchaseForm["chapters"][number]["lines"],
    options: { subcontractorId: string; description: string; status?: string; orderedOn?: string; completedOn?: string; expectedOn?: string; open?: string },
  ) => {
    if (lines.length === 0) return;
    const kind = isSupplier(options.subcontractorId) ? "material" : "subcontract";
    const { orderId } = await purchasing.createPurchase(ctx, projectId, {
      kind,
      subcontractorId: options.subcontractorId,
      description: options.description,
      expectedOn: options.expectedOn ?? null,
      workStart: kind === "subcontract" ? (chapter.plannedStart ?? null) : null,
      workEnd: kind === "subcontract" ? (chapter.plannedEnd ?? null) : null,
      lines: lines.map((l) => ({
        lineageId: l.lineageId,
        amountCents: l.lineageId === options.open ? Math.round(l.costCents / 2) : contracted(l.lineageId, l.costCents),
        closesLine: l.lineageId !== options.open,
      })),
    });
    made++;
    if (!options.status) return;
    const placed = kind === "material" ? "ordered" : "contracted";
    await purchasing.setPurchaseStatus(ctx, orderId, { status: placed, date: options.orderedOn });
    if (options.status !== placed) {
      await purchasing.setPurchaseStatus(ctx, orderId, { status: options.status, date: options.completedOn });
    }
  };

  const pending: PurchaseForm["chapters"] = [];
  let lateSeeded = false;
  for (const chapter of form.chapters) {
    const recorded: ControlChapter | undefined = progress.get(chapter.code);
    const lines = chapter.lines.filter((l) => l.costCents > 0);
    if (!recorded || recorded.state === "pending") {
      pending.push(chapter);
      continue;
    }
    const start = recorded.actualStart!;
    const orderedOn = earlier(addDays(start, -14), today);
    const builder = supplier(chapter.code);
    if (recorded.state === "finished") {
      const done = isSupplier(builder) ? "delivered" : "finished";
      await order(chapter, lines, {
        subcontractorId: builder,
        description: chapter.name,
        status: done,
        orderedOn,
        completedOn: recorded.actualEnd!,
      });
      continue;
    }
    // Under way: most lines contracted, one more open, one delivery late (once), the rest not ordered yet.
    type Line = (typeof lines)[number];
    const stone: Line | undefined = lateSeeded ? undefined : (lines.find((l) => /piedra/i.test(l.description)) ?? lines[lines.length - 1]);
    lateSeeded ||= stone !== undefined;
    const rest = lines.filter((l) => l !== stone);
    const contractedLines = rest.slice(0, Math.max(1, Math.ceil((rest.length * 2) / 3)));
    await order(chapter, contractedLines, {
      subcontractorId: builder,
      description: chapter.name,
      status: isSupplier(builder) ? "confirmed" : "contracted",
      orderedOn,
      open: contractedLines[contractedLines.length - 1]?.lineageId,
    });
    if (stone) {
      await order(chapter, [stone], {
        subcontractorId: byName.get("Piedra de Liébana S.L.")!,
        description: stone.description.slice(0, 120),
        status: "in_transit",
        orderedOn: earlier(addDays(today, -14), today),
        expectedOn: addDays(today, -3),
      });
    }
  }

  // The next chapters: one order confirmed for the windows, the others not sent yet.
  for (const chapter of pending.slice(0, 3)) {
    const lines = chapter.lines.filter((l) => l.costCents > 0);
    const builder = supplier(chapter.code);
    const material = isSupplier(builder);
    await order(chapter, lines, {
      subcontractorId: builder,
      description: chapter.name,
      status: chapter.code === "10" ? "confirmed" : undefined,
      orderedOn: addDays(today, -10),
      // Expected before the chapter starts, and not overdue yet.
      expectedOn: material ? [addDays(chapter.plannedStart ?? today, -7), addDays(today, 18)].sort()[1] : undefined,
    });
  }
  return made;
}
