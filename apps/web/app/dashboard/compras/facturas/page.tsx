import { redirect } from "next/navigation";
import { getInvoices } from "../../../actions/purchase-invoices";
import InvoicesScreen from "./InvoicesScreen";

/** Compras › Facturas: the suppliers' invoices of every obra, for Administration. */
export default async function InvoicesPage() {
  const result = await getInvoices();
  if (!result) redirect("/dashboard");
  return <InvoicesScreen invoices={result.invoices} canManage={result.canManage} />;
}
