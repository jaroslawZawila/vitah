import {
  DEFAULT_PAGE_SIZE,
  PURCHASE_INVOICE_GROUPS,
  PURCHASE_KINDS,
  PURCHASE_ORDER_GROUPS,
  type InvoiceListQuery,
  type PurchaseListQuery,
} from "@repo/core/contract";
import { choiceParam, dayParam, pageParam, param, type SearchParams } from "../../../lib/list-query";

// Compras' lists keep their filters in the URL: the server filters, counts and
// cuts the page (packages/core), so a list of any length costs one page. Pure:
// what the pages read from the URL, and what they ask core for.

const ORDER_GROUPS = ["all", ...PURCHASE_ORDER_GROUPS] as const;
const ORDER_KINDS = ["all", ...PURCHASE_KINDS] as const;

/** Compras › Pedidos: `?vista=proveedores&estado=&obra=&proveedor=&tipo=&desde=&hasta=&retraso=1&q=&page=`. */
export type OrdersQuery = {
  view: "orders" | "suppliers";
  group: (typeof ORDER_GROUPS)[number];
  projectId: string;
  supplierId: string;
  kind: (typeof ORDER_KINDS)[number];
  from: string;
  to: string;
  lateOnly: boolean;
  query: string;
  page: number;
};

export function parseOrdersQuery(params: SearchParams): OrdersQuery {
  return {
    view: param(params, "vista") === "proveedores" ? "suppliers" : "orders",
    group: choiceParam(params, "estado", ORDER_GROUPS),
    projectId: param(params, "obra"),
    supplierId: param(params, "proveedor"),
    kind: choiceParam(params, "tipo", ORDER_KINDS),
    from: dayParam(params, "desde"),
    to: dayParam(params, "hasta"),
    lateOnly: param(params, "retraso") === "1",
    query: param(params, "q"),
    page: pageParam(params),
  };
}

/** What narrows the orders: the same for the page shown and for the CSV of all of them. */
export const ordersFilters = (query: OrdersQuery): PurchaseListQuery => ({
  group: query.group,
  projectId: query.projectId,
  supplierId: query.supplierId,
  kind: query.kind,
  from: query.from,
  to: query.to,
  late: query.lateOnly ? "1" : "",
  q: query.query,
});

/** The page of orders to ask for; by supplier, the breakdown instead (its rows aren't paged). */
export const ordersPage = (query: OrdersQuery): PurchaseListQuery => ({
  ...ordersFilters(query),
  page: query.page,
  limit: DEFAULT_PAGE_SIZE,
  ...(query.view === "suppliers" && { by: "supplier" }),
});

export const hasOrdersFilter = (query: OrdersQuery) =>
  query.group !== "all" || query.kind !== "all" || query.lateOnly || [query.projectId, query.supplierId, query.from, query.to, query.query].some(Boolean);

const INVOICE_GROUPS = ["all", ...PURCHASE_INVOICE_GROUPS] as const;

/** Compras › Facturas: `?estado=&obra=&proveedor=&q=&page=`. */
export type InvoicesQuery = {
  group: (typeof INVOICE_GROUPS)[number];
  projectId: string;
  supplierId: string;
  query: string;
  page: number;
};

export function parseInvoicesQuery(params: SearchParams): InvoicesQuery {
  return {
    group: choiceParam(params, "estado", INVOICE_GROUPS),
    projectId: param(params, "obra"),
    supplierId: param(params, "proveedor"),
    query: param(params, "q"),
    page: pageParam(params),
  };
}

export const invoicesPage = (query: InvoicesQuery): InvoiceListQuery => ({
  group: query.group,
  projectId: query.projectId,
  supplierId: query.supplierId,
  q: query.query,
  page: query.page,
  limit: DEFAULT_PAGE_SIZE,
});

export const hasInvoicesFilter = (query: InvoicesQuery) =>
  query.group !== "all" || [query.projectId, query.supplierId, query.query].some(Boolean);
