import {
  countsAsContracted,
  isCompletedOrder,
  isOpenOrder,
  orderLabel,
  type PurchaseKind,
  type PurchaseOrderListItem,
  type PurchaseStatus,
} from "@repo/core/contract";

// Pure rules of the Compras lists: how orders group and filter, the totals
// and the CSV export.

/** How the lists group an order: open (placed, not completed), not sent yet, completed or cancelled. */
export type OrderGroup = "open" | "pending" | "done" | "cancelled";

export function orderGroup(status: PurchaseStatus): OrderGroup {
  if (status === "pending" || status === "cancelled") return status;
  return isCompletedOrder(status) ? "done" : "open";
}

export type OrderFilter = {
  group: "all" | OrderGroup;
  /** "" for every one. */
  supplierId: string;
  chapter: string;
  projectId: string;
  kind: "all" | PurchaseKind;
  /** Order date range (YYYY-MM-DD, "" for open). */
  from: string;
  to: string;
  lateOnly: boolean;
  query: string;
};

export const NO_ORDER_FILTER: OrderFilter = {
  group: "all",
  supplierId: "",
  chapter: "",
  projectId: "",
  kind: "all",
  from: "",
  to: "",
  lateOnly: false,
  query: "",
};

/** The day an order counts from: its order date, or the day it was created while pending. */
const orderDay = (order: PurchaseOrderListItem) => order.orderedOn ?? order.createdAt.slice(0, 10);

/** The orders a filter keeps (every criterion but `group` when `ignoreGroup`, for the counts beside it). */
export function filterOrders(orders: PurchaseOrderListItem[], filter: OrderFilter, ignoreGroup = false) {
  const query = filter.query.trim().toLowerCase();
  return orders.filter((o) => {
    const day = orderDay(o);
    return (
      (ignoreGroup || filter.group === "all" || orderGroup(o.status) === filter.group) &&
      (!filter.supplierId || o.subcontractorId === filter.supplierId) &&
      (!filter.chapter || o.chapterCodes.includes(filter.chapter)) &&
      (!filter.projectId || o.projectId === filter.projectId) &&
      (filter.kind === "all" || o.kind === filter.kind) &&
      (!filter.from || day >= filter.from) &&
      (!filter.to || day <= filter.to) &&
      (!filter.lateOnly || o.lateDays !== null) &&
      (!query ||
        orderLabel(o.number).toLowerCase().includes(query) ||
        o.supplierName.toLowerCase().includes(query) ||
        o.description.toLowerCase().includes(query) ||
        o.projectRef.toLowerCase().includes(query))
    );
  });
}

/** How many of `orders` fall in each group, and in all. */
export function groupCounts(orders: PurchaseOrderListItem[]): Record<"all" | OrderGroup, number> {
  const counts = { all: orders.length, open: 0, pending: 0, done: 0, cancelled: 0 };
  for (const o of orders) counts[orderGroup(o.status)]++;
  return counts;
}

/** What the orders contract: pending and cancelled ones don't add up. */
export const contractedCents = (orders: PurchaseOrderListItem[]) =>
  orders.filter((o) => countsAsContracted(o.status)).reduce((sum, o) => sum + o.amountCents, 0);

/** The suppliers that appear in `orders`, by name. */
export function suppliersOf(orders: { subcontractorId: string; supplierName: string }[]) {
  const names = new Map(orders.map((o) => [o.subcontractorId, o.supplierName]));
  return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export type SupplierGroup = {
  id: string;
  name: string;
  suppliesOnly: boolean;
  orders: number;
  projectRefs: string[];
  contractedCents: number;
  openCents: number;
};

/** The orders by supplier, the most contracted first. */
export function bySupplier(orders: PurchaseOrderListItem[]): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();
  for (const o of orders) {
    const group = groups.get(o.subcontractorId) ?? {
      id: o.subcontractorId,
      name: o.supplierName,
      suppliesOnly: o.suppliesOnly,
      orders: 0,
      projectRefs: [],
      contractedCents: 0,
      openCents: 0,
    };
    group.orders++;
    if (!group.projectRefs.includes(o.projectRef)) group.projectRefs.push(o.projectRef);
    if (countsAsContracted(o.status)) group.contractedCents += o.amountCents;
    if (isOpenOrder(o.status)) group.openCents += o.amountCents;
    groups.set(o.subcontractorId, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, projectRefs: g.projectRefs.sort() }))
    .sort((a, b) => b.contractedCents - a.contractedCents || a.name.localeCompare(b.name));
}

/**
 * One CSV cell: quoted when it holds a separator, a quote or a line break.
 * Text a spreadsheet would run as a formula (=, +, -, @) gets a leading
 * apostrophe; numbers stay as they are.
 */
const cell = (value: string | number) => {
  const text = typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The orders as CSV (`;`-separated, as Spanish spreadsheets expect), with
 * `headings` and each order's cells from `row`.
 */
export function toCsv<T>(headings: string[], items: T[], row: (item: T) => (string | number)[]) {
  return [headings, ...items.map(row)].map((cells) => cells.map(cell).join(";")).join("\r\n");
}
