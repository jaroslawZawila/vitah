import {
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  projects,
  purchaseInvoiceFiles,
  purchaseInvoiceLines,
  purchaseInvoices,
  purchaseOrderMilestones,
  purchaseOrders,
  purchasePayments,
  sql,
  subcontractors,
  users,
  type SQL,
} from "@repo/db";
import type {
  OrderInvoicing,
  OrderMilestone,
  PurchaseInvoiceListItem,
  PurchaseInvoicing,
  PurchasePayment,
} from "./contract";
import { groupBy, userName } from "./obra-data";
import {
  addInvoicing,
  invoiceState,
  purchaseProgress,
  settle,
  shareOf,
  withTotals,
  type Settlement,
} from "./purchase-calc";

// ─── Supplier invoices: loading ──────────────────────────────────────────────
// What the orders' pages, the obra's Compras by line and Administration's
// invoices and payments share: loading invoices (always whole orders, so a
// credit note travels with its invoice), settling each invoice with its
// credit notes and payments, and summing that up by order, milestone and
// budget line.
// ─────────────────────────────────────────────────────────────────────────────

export type MilestoneRow = typeof purchaseOrderMilestones.$inferSelect;

/**
 * Invoices with their order, project, supplier and milestone, their lines
 * (unless `lines` is false: the lists don't need them), what was paid on
 * each and whether it has a PDF; newest first. `where` should select whole
 * orders (by order, project, supplier or tenant).
 */
export async function loadInvoices(tenantId: string, where?: SQL, { lines: withLines = true } = {}) {
  const rows = await db
    .select({
      invoice: purchaseInvoices,
      orderNumber: purchaseOrders.number,
      orderDescription: purchaseOrders.description,
      projectId: purchaseOrders.projectId,
      projectRef: projects.ref,
      supplierName: subcontractors.legalName,
      milestoneConcept: purchaseOrderMilestones.concept,
    })
    .from(purchaseInvoices)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseInvoices.orderId))
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .innerJoin(subcontractors, eq(subcontractors.id, purchaseInvoices.subcontractorId))
    .leftJoin(purchaseOrderMilestones, eq(purchaseOrderMilestones.id, purchaseInvoices.milestoneId))
    .where(and(eq(purchaseInvoices.tenantId, tenantId), where))
    .orderBy(desc(purchaseInvoices.issuedOn), desc(purchaseInvoices.createdAt));
  const ids = rows.map((r) => r.invoice.id);
  const [lineRows, paidRows, fileRows] =
    ids.length === 0
      ? [[], [], []]
      : await Promise.all([
          withLines
            ? db
                .select()
                .from(purchaseInvoiceLines)
                .where(and(eq(purchaseInvoiceLines.tenantId, tenantId), inArray(purchaseInvoiceLines.invoiceId, ids)))
            : [],
          db
            .select({ invoiceId: purchasePayments.invoiceId, paid: sql<string>`sum(${purchasePayments.amountCents})` })
            .from(purchasePayments)
            .where(and(eq(purchasePayments.tenantId, tenantId), inArray(purchasePayments.invoiceId, ids)))
            .groupBy(purchasePayments.invoiceId),
          db
            .selectDistinct({ invoiceId: purchaseInvoiceFiles.invoiceId })
            .from(purchaseInvoiceFiles)
            .where(and(eq(purchaseInvoiceFiles.tenantId, tenantId), inArray(purchaseInvoiceFiles.invoiceId, ids))),
        ]);
  const lines = groupBy(lineRows, (l) => l.invoiceId);
  const paid = new Map(paidRows.map((p) => [p.invoiceId, Number(p.paid)]));
  const withFile = new Set(fileRows.map((f) => f.invoiceId));
  return rows.map((row) => ({
    ...row,
    lines: lines.get(row.invoice.id) ?? [],
    paidCents: paid.get(row.invoice.id) ?? 0,
    hasFile: withFile.has(row.invoice.id),
  }));
}

export type LoadedInvoice = Awaited<ReturnType<typeof loadInvoices>>[number];

/** An invoice and its credit notes, settled. */
export type InvoiceGroup = { invoice: LoadedInvoice; credits: LoadedInvoice[]; settlement: Settlement };

/**
 * The loaded invoices as list items, and each invoice's group (with its
 * credit notes, settled against its payments), by invoice id.
 */
export function buildInvoices(loaded: LoadedInvoice[], today: string) {
  const byId = new Map(loaded.map((l) => [l.invoice.id, l]));
  const credits = groupBy(
    loaded.filter((l) => l.invoice.kind === "credit_note" && l.invoice.rectifiesId),
    (l) => l.invoice.rectifiesId!,
  );
  const groups = new Map<string, InvoiceGroup>();
  for (const l of loaded) {
    if (l.invoice.kind !== "invoice") continue;
    const own = credits.get(l.invoice.id) ?? [];
    groups.set(l.invoice.id, {
      invoice: l,
      credits: own,
      settlement: settle(withTotals(l.invoice), own.map((c) => withTotals(c.invoice)), l.paidCents),
    });
  }
  const items = new Map<string, PurchaseInvoiceListItem>();
  for (const l of loaded) {
    const { invoice } = l;
    const settlement = groups.get(invoice.id)?.settlement;
    const rectified = invoice.rectifiesId ? byId.get(invoice.rectifiesId) : undefined;
    const paidCents = settlement?.paidCents ?? 0;
    const outstandingCents = settlement?.outstandingCents ?? 0;
    items.set(invoice.id, {
      ...withTotals(invoice),
      id: invoice.id,
      kind: invoice.kind,
      number: invoice.number,
      orderId: invoice.orderId,
      orderNumber: l.orderNumber,
      orderDescription: l.orderDescription,
      projectId: l.projectId,
      projectRef: l.projectRef,
      subcontractorId: invoice.subcontractorId,
      supplierName: l.supplierName,
      // A credit note goes with its invoice's milestone.
      milestoneId: invoice.milestoneId ?? rectified?.invoice.milestoneId ?? null,
      milestoneConcept: l.milestoneConcept ?? rectified?.milestoneConcept ?? null,
      rectifiesId: invoice.rectifiesId,
      rectifiesNumber: rectified?.invoice.number ?? null,
      issuedOn: invoice.issuedOn,
      dueOn: invoice.dueOn,
      paidCents,
      outstandingCents,
      retainedCents: settlement?.retainedCents ?? 0,
      ...invoiceState({ kind: invoice.kind, dueOn: invoice.dueOn, paidCents, outstandingCents }, today),
      hasFile: l.hasFile,
      createdAt: invoice.createdAt.toISOString(),
    });
  }
  const all = [...groups.values()];
  return {
    items,
    groups,
    // Indexed once: an order's or a milestone's groups and items are read many times.
    groupsByOrder: groupBy(all, (g) => g.invoice.invoice.orderId),
    groupsByMilestone: groupBy(
      all.filter((g) => g.invoice.invoice.milestoneId),
      (g) => g.invoice.invoice.milestoneId!,
    ),
    itemsByOrder: groupBy([...items.values()], (i) => i.orderId),
  };
}

export type BuiltInvoices = ReturnType<typeof buildInvoices>;

/** The groups of one order's invoices. */
export const groupsOfOrder = (built: BuiltInvoices, orderId: string) => built.groupsByOrder.get(orderId) ?? [];

/** The order's items, newest first (as loaded). */
export const itemsOfOrder = (built: BuiltInvoices, orderId: string) => built.itemsByOrder.get(orderId) ?? [];

/** An order's invoicing, without VAT: its groups summed, and what of its amount is left to invoice. */
export function orderInvoicing(amountCents: number, groups: InvoiceGroup[]): OrderInvoicing {
  const total = addInvoicing(groups.map((g) => g.settlement.base));
  return { ...total, toInvoiceCents: Math.max(0, amountCents - total.invoicedCents) };
}

/** Each group's base by budget line (lineage): its invoice's lines and its credit notes'. */
function groupLines(group: InvoiceGroup) {
  const byLine = new Map<string, number>();
  for (const member of [group.invoice, ...group.credits]) {
    for (const line of member.lines) byLine.set(line.lineageId, (byLine.get(line.lineageId) ?? 0) + line.amountCents);
  }
  return byLine;
}

/** What one budget line has invoiced, and how that stands (only lines with invoices). */
export type LineInvoicing = PurchaseInvoicing & {
  /** Its invoices' groups: none owes anything by its due date. */
  settled: boolean;
  overdue: boolean;
};

/** Every group's invoicing split across its budget lines, by lineage. */
export function invoicingByLine(built: BuiltInvoices) {
  const byLine = new Map<string, LineInvoicing>();
  for (const group of built.groups.values()) {
    const { base, settled } = group.settlement;
    const overdue = built.items.get(group.invoice.invoice.id)?.state === "overdue";
    for (const [lineageId, cents] of groupLines(group)) {
      const share = shareOf(base, cents, base.invoicedCents);
      const line = byLine.get(lineageId) ?? {
        invoicedCents: 0,
        paidCents: 0,
        outstandingCents: 0,
        retainedCents: 0,
        settled: true,
        overdue: false,
      };
      byLine.set(lineageId, {
        ...addInvoicing([line, share]),
        settled: line.settled && settled,
        overdue: line.overdue || overdue,
      });
    }
  }
  return byLine;
}

/** The payment schedules of the orders `where` selects (by order or project), by order, in turn. */
export async function loadMilestones(tenantId: string, where: SQL) {
  const rows = await db
    .select({ milestone: purchaseOrderMilestones })
    .from(purchaseOrderMilestones)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderMilestones.orderId))
    .where(and(eq(purchaseOrderMilestones.tenantId, tenantId), where))
    .orderBy(asc(purchaseOrderMilestones.position));
  return groupBy(
    rows.map((r) => r.milestone),
    (m) => m.orderId,
  );
}

/** An order's milestones with what is invoiced and paid of each. */
export function orderMilestones(milestones: MilestoneRow[], built: BuiltInvoices): OrderMilestone[] {
  return milestones.map((m) => {
    const groups = built.groupsByMilestone.get(m.id) ?? [];
    const invoicing = addInvoicing(groups.map((g) => g.settlement.base));
    return {
      id: m.id,
      position: m.position,
      concept: m.concept,
      amountCents: m.amountCents,
      ...invoicing,
      progress: purchaseProgress({
        contracted: true,
        closed: true,
        contractedCents: m.amountCents,
        invoicedCents: invoicing.invoicedCents,
        hasInvoices: groups.length > 0,
        settled: groups.every((g) => g.settlement.settled),
      }) as OrderMilestone["progress"],
      invoices: groups.map((g) => {
        const item = built.items.get(g.invoice.invoice.id)!;
        return { id: item.id, number: item.number, state: item.state, issuedOn: item.issuedOn, dueOn: item.dueOn };
      }),
    };
  });
}

/** Each order's invoiced base, credit notes off. */
export async function invoicedByOrder(tenantId: string, orderIds: string[]) {
  if (orderIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ orderId: purchaseInvoices.orderId, base: sql<string>`sum(${purchaseInvoices.baseCents})` })
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.tenantId, tenantId), inArray(purchaseInvoices.orderId, orderIds)))
    .groupBy(purchaseInvoices.orderId);
  return new Map(rows.map((r) => [r.orderId, Number(r.base)]));
}

/** Payments with their invoice, order, project and supplier, newest first. */
export async function loadPayments(tenantId: string, where?: SQL): Promise<PurchasePayment[]> {
  const rows = await db
    .select({
      payment: purchasePayments,
      invoiceNumber: purchaseInvoices.number,
      orderId: purchaseInvoices.orderId,
      projectId: purchaseOrders.projectId,
      projectRef: projects.ref,
      supplierName: subcontractors.legalName,
      by: userName,
    })
    .from(purchasePayments)
    .innerJoin(purchaseInvoices, eq(purchaseInvoices.id, purchasePayments.invoiceId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseInvoices.orderId))
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .innerJoin(subcontractors, eq(subcontractors.id, purchaseInvoices.subcontractorId))
    .leftJoin(users, eq(users.id, purchasePayments.createdById))
    .where(and(eq(purchasePayments.tenantId, tenantId), where))
    .orderBy(desc(purchasePayments.paidOn), desc(purchasePayments.createdAt));
  return rows.map(({ payment, ...row }) => ({
    id: payment.id,
    invoiceId: payment.invoiceId,
    invoiceNumber: row.invoiceNumber,
    orderId: row.orderId,
    projectId: row.projectId,
    projectRef: row.projectRef,
    supplierName: row.supplierName,
    paidOn: payment.paidOn,
    amountCents: payment.amountCents,
    method: payment.method,
    reference: payment.reference,
    file: payment.filePathname ? { name: payment.fileName ?? "justificante.pdf", sizeBytes: payment.fileSizeBytes ?? 0 } : null,
    by: row.by,
    createdAt: payment.createdAt.toISOString(),
  }));
}
