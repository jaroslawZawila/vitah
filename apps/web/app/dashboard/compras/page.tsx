import { notFound, redirect } from "next/navigation";
import { lastPageUrl, type SearchParams } from "../../../lib/list-query";
import { getPurchases } from "../../actions/purchasing";
import ComprasScreen from "./ComprasScreen";
import { ordersPage, parseOrdersQuery } from "./list-query";

/**
 * Compras (all obras): the orders and subcontracts of the company, for
 * Administration, a page at a time. Its filters are in the URL
 * (`?estado=&obra=&proveedor=&tipo=&desde=&hasta=&retraso=1&q=&page=`, and
 * `?vista=proveedores` for the orders by supplier): the server applies them.
 */
export default async function CompanyPurchasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const query = parseOrdersQuery(params);
  const result = await getPurchases(ordersPage(query));
  if (!result) notFound();
  // A page past the end (an order cancelled on the last one, an old bookmark): the last there is.
  const last = lastPageUrl("/dashboard/compras", params, result.purchases.paging);
  if (last) redirect(last);
  return <ComprasScreen purchases={result.purchases} query={query} />;
}
