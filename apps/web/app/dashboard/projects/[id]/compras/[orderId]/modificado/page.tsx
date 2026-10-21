import { notFound, redirect } from "next/navigation";
import { canAmend } from "@repo/core/contract";
import { getPurchase, getPurchaseForm } from "../../../../../../actions/purchasing";
import { orderHref } from "../../../components/purchasing/links";
import AmendmentFormScreen from "./AmendmentFormScreen";

/** Compras › an order › Registrar modificado (admins and managers, a placed order). */
export default async function AmendPurchaseOrderPage({ params }: { params: Promise<{ id: string; orderId: string }> }) {
  const { id, orderId } = await params;
  const [form, order] = await Promise.all([getPurchaseForm(id, orderId), getPurchase(orderId)]);
  if (!form?.form.editing || !order || order.order.projectId !== id) notFound();
  if (!form.canManage || !canAmend(order.order.status)) redirect(orderHref(id, orderId));
  return <AmendmentFormScreen projectId={id} form={form.form} order={order.order} />;
}
