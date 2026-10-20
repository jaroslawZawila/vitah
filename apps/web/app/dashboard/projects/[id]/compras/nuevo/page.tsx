import { notFound, redirect } from "next/navigation";
import { getRequest } from "../../../../../actions/purchase-requests";
import { getPurchaseForm } from "../../../../../actions/purchasing";
import { purchasesHref, requestHref } from "../../components/purchasing/links";
import OrderFormScreen from "../OrderFormScreen";

/**
 * Compras › Nuevo pedido (admins and managers). `?capitulo=` starts on that
 * chapter's lines; `?solicitud=` fills it in from an approved purchase request.
 */
export default async function NewPurchaseOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ capitulo?: string; solicitud?: string }>;
}) {
  const [{ id }, { capitulo, solicitud }] = await Promise.all([params, searchParams]);
  const [result, fromRequest] = await Promise.all([getPurchaseForm(id), solicitud ? getRequest(solicitud) : null]);
  if (!result) redirect("/dashboard/projects");
  if (!result.canManage) redirect(purchasesHref(id));
  if (!solicitud) return <OrderFormScreen projectId={id} form={result.form} chapter={capitulo} />;
  if (!fromRequest || fromRequest.request.projectId !== id) notFound();
  // Only an approved request becomes an order; one ordered or withdrawn meanwhile shows why on its page.
  if (fromRequest.request.status !== "approved") redirect(requestHref(id, fromRequest.request.id));
  return <OrderFormScreen projectId={id} form={result.form} request={fromRequest.request} />;
}
