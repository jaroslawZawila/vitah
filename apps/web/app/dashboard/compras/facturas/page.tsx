import { notFound, redirect } from "next/navigation";
import { lastPageUrl, type SearchParams } from "../../../../lib/list-query";
import { getInvoices } from "../../../actions/purchase-invoices";
import { invoicesPage, parseInvoicesQuery } from "../list-query";
import InvoicesScreen from "./InvoicesScreen";

/**
 * Compras › Facturas: the suppliers' invoices of every obra, for Administration,
 * a page at a time. Its filters are in the URL (`?estado=&obra=&proveedor=&q=&page=`):
 * the server applies them.
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const query = parseInvoicesQuery(params);
  const result = await getInvoices(invoicesPage(query));
  if (!result) notFound();
  // A page past the end (an invoice deleted on the last one, an old bookmark): the last there is.
  const last = lastPageUrl("/dashboard/compras/facturas", params, result.invoices.paging);
  if (last) redirect(last);
  return <InvoicesScreen invoices={result.invoices} canManage={result.canManage} query={query} />;
}
