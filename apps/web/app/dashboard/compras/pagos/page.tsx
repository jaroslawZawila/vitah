import { redirect } from "next/navigation";
import { getPayments } from "../../../actions/purchase-invoices";
import PaymentsScreen from "./PaymentsScreen";

/** Compras › Pagos: the payments forecast and the payments made, for Administration. */
export default async function PaymentsPage() {
  const result = await getPayments();
  if (!result) redirect("/dashboard");
  return <PaymentsScreen payments={result.payments} canManage={result.canManage} />;
}
