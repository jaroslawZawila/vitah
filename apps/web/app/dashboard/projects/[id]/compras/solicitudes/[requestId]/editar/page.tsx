import { notFound, redirect } from "next/navigation";
import { getPurchaseForm } from "../../../../../../../actions/purchasing";
import { getRequest } from "../../../../../../../actions/purchase-requests";
import { requestHref } from "../../../../components/purchasing/links";
import RequestFormScreen from "../../../RequestFormScreen";

/** Compras › a purchase request, edited (admins and managers, while it waits for approval). */
export default async function EditPurchaseRequestPage({ params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await params;
  const [result, form] = await Promise.all([getRequest(requestId), getPurchaseForm(id)]);
  if (!result || result.request.projectId !== id || !form) notFound();
  if (!result.canManage || result.request.status !== "pending") redirect(requestHref(id, requestId));
  return <RequestFormScreen projectId={id} form={form.form} request={result.request} />;
}
