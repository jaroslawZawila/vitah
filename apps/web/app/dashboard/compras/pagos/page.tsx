import { DEFAULT_PAGE_SIZE } from "@repo/core/contract";
import { notFound, redirect } from "next/navigation";
import { lastPageUrl, pageParam, type SearchParams } from "../../../../lib/list-query";
import { getPayments } from "../../../actions/purchase-invoices";
import PaymentsScreen from "./PaymentsScreen";

/** Compras › Pagos: the payments forecast and the payments made (a page at a time: `?page=`), for Administration. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const result = await getPayments({ page: pageParam(params), limit: DEFAULT_PAGE_SIZE });
  if (!result) notFound();
  // A payment taken back on the last page may leave it empty.
  const last = lastPageUrl("/dashboard/compras/pagos", params, result.payments.paging);
  if (last) redirect(last);
  return <PaymentsScreen payments={result.payments} canManage={result.canManage} />;
}
