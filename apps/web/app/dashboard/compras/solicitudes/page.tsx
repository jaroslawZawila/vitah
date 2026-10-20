import { redirect } from "next/navigation";
import { getRequests } from "../../../actions/purchase-requests";
import RequestsScreen from "./RequestsScreen";

/** Compras › Solicitudes: what every obra asks to buy, those to approve first. */
export default async function PurchaseRequestsPage() {
  const result = await getRequests();
  if (!result) redirect("/dashboard");
  return <RequestsScreen requests={result.requests} />;
}
