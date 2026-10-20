import { notFound } from "next/navigation";
import { getRequest } from "../../../../../../actions/purchase-requests";
import RequestScreen from "./RequestScreen";

/** Compras › a purchase request (SOL-003): its decision, lines, data and history. */
export default async function PurchaseRequestPage({ params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await params;
  const result = await getRequest(requestId);
  if (!result || result.request.projectId !== id) notFound();
  return <RequestScreen projectId={id} request={result.request} canManage={result.canManage} canDecide={result.canDecide} />;
}
