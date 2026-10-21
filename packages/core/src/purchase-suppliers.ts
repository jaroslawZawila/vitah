import { asc, db, eq, purchaseInvoices, subcontractors } from "@repo/db";
import type { Ctx } from "./context";
import {
  countsAsContracted,
  type PurchaseInvoiceListItem,
  type PurchaseOrderListItem,
  type PurchaseSupplierItem,
  type SupplierPurchasing,
  type TenantSuppliers,
} from "./contract";
import { groupBy } from "./obra-data";
import { todayInSpain } from "./obra-calc";
import { isOwed } from "./purchase-calc";
import { buildInvoices, loadInvoices, loadPayments, type BuiltInvoices } from "./purchase-invoice-data";
import { byUrgency, sumOwed } from "./purchase-invoices";
import { listSupplierOrders, loadOrders, toListItem } from "./purchasing";
import { loadNetwork, requireCompany } from "./subcontractor-network";

// ─── Suppliers (Compras › Proveedores) ───────────────────────────────────────
// Every Subcontratas company as Compras sees it: what it was ordered across
// the obras, invoiced and paid (without VAT, as compared with the cost), and
// what is owed (with VAT, as Facturas and Pagos show it). Read-only: orders,
// invoices and payments are written in their own sections, the company's
// data and CAE on its Subcontratas ficha. Staff only.
// ─────────────────────────────────────────────────────────────────────────────

type Company = Pick<typeof subcontractors.$inferSelect, "id" | "legalName" | "kind" | "suppliesOnly">;
const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

/** One supplier's figures from its orders and its invoices (built). */
function supplierItem(
  company: Company,
  caeStatus: PurchaseSupplierItem["caeStatus"],
  orders: PurchaseOrderListItem[],
  invoices: PurchaseInvoiceListItem[],
  built: BuiltInvoices,
): PurchaseSupplierItem {
  const live = orders.filter((o) => o.status !== "cancelled");
  // Each invoice with its credit notes, without VAT.
  const bases = invoices.flatMap((i) => (i.kind === "invoice" ? [built.groups.get(i.id)?.settlement.base] : [])).filter((b) => !!b);
  const owed = invoices.filter((i) => i.kind === "invoice" && isOwed(i.state));
  const orderedOn = live.map((o) => o.orderedOn ?? todayInSpain(new Date(o.createdAt))).sort();
  return {
    id: company.id,
    legalName: company.legalName,
    kind: company.kind,
    suppliesOnly: company.suppliesOnly,
    caeStatus,
    orders: live.length,
    projects: new Set(live.map((o) => o.projectId)).size,
    contractedCents: sum(live.filter((o) => countsAsContracted(o.status)).map((o) => o.amountCents)),
    invoicedCents: sum(bases.map((b) => b.invoicedCents)),
    paidCents: sum(bases.map((b) => b.paidCents)),
    outstandingCents: sumOwed(owed),
    overdueCents: sumOwed(owed.filter((i) => i.state === "overdue")),
    retainedCents: sum(invoices.map((i) => i.retainedCents)),
    lastOrderOn: orderedOn.at(-1) ?? null,
  };
}

/** Owed first (most first), then by what was contracted, then by name. */
const byAttention = (a: PurchaseSupplierItem, b: PurchaseSupplierItem) =>
  b.outstandingCents - a.outstandingCents || b.contractedCents - a.contractedCents || a.legalName.localeCompare(b.legalName, "es");

/** Every company of the tenant as a supplier: those owed first. */
export async function listSuppliers(ctx: Ctx): Promise<TenantSuppliers> {
  const today = todayInSpain();
  const [companies, orders, invoices, net] = await Promise.all([
    db
      .select({ id: subcontractors.id, legalName: subcontractors.legalName, kind: subcontractors.kind, suppliesOnly: subcontractors.suppliesOnly })
      .from(subcontractors)
      .where(eq(subcontractors.tenantId, ctx.tenantId))
      .orderBy(asc(subcontractors.legalName)),
    loadOrders(ctx.tenantId),
    loadInvoices(ctx.tenantId, undefined, { lines: false }),
    loadNetwork(ctx.tenantId),
  ]);
  const built = buildInvoices(invoices, today);
  const ordersBy = groupBy(
    orders.map((o) => toListItem(o, null, today)),
    (o) => o.subcontractorId,
  );
  const invoicesBy = groupBy([...built.items.values()], (i) => i.subcontractorId);
  const suppliers = companies
    .map((c) => supplierItem(c, net.status(c.id).status, ordersBy.get(c.id) ?? [], invoicesBy.get(c.id) ?? [], built))
    .sort(byAttention);
  const overdue = suppliers.filter((s) => s.overdueCents > 0);
  return {
    suppliers,
    summary: {
      active: suppliers.filter((s) => s.orders > 0).length,
      contractedCents: sum(suppliers.map((s) => s.contractedCents)),
      outstandingCents: sum(suppliers.map((s) => s.outstandingCents)),
      overdueCents: sum(overdue.map((s) => s.overdueCents)),
      overdueSuppliers: overdue.length,
      retainedCents: sum(suppliers.map((s) => s.retainedCents)),
    },
  };
}

/** One supplier: its figures, its orders across the obras (as on its ficha), its invoices (owed first) and payments. */
export async function getSupplierPurchasing(ctx: Ctx, subcontractorId: string): Promise<SupplierPurchasing> {
  const today = todayInSpain();
  const ofInvoices = eq(purchaseInvoices.subcontractorId, subcontractorId);
  const [company, orders, invoices, payments, net] = await Promise.all([
    requireCompany(ctx, subcontractorId),
    listSupplierOrders(ctx, subcontractorId),
    loadInvoices(ctx.tenantId, ofInvoices, { lines: false }),
    loadPayments(ctx.tenantId, ofInvoices),
    loadNetwork(ctx.tenantId, subcontractorId),
  ]);
  const built = buildInvoices(invoices, today);
  const items = [...built.items.values()].sort(byUrgency);
  return {
    supplier: supplierItem(company, net.status(company.id).status, orders, items, built),
    orders,
    invoices: items,
    payments,
    today,
  };
}
