import { notFound, redirect } from "next/navigation";
import { getPurchaseForm } from "../../../../../../actions/purchasing";
import { orderHref } from "../../../components/purchasing/links";
import OrderFormScreen from "../../OrderFormScreen";

/** Compras › an order › Editar (admins and managers): the new-order form on its values. */
export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string; orderId: string }> }) {
  const { id, orderId } = await params;
  const result = await getPurchaseForm(id, orderId);
  if (!result?.form.editing) notFound();
  if (!result.canManage || result.form.editing.status === "cancelled") redirect(orderHref(id, orderId));
  return <OrderFormScreen projectId={id} form={result.form} />;
}
