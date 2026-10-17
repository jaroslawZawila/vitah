import { notFound } from "next/navigation";
import { getPurchase } from "../../../../../actions/purchasing";
import OrderScreen from "./OrderScreen";

/** Compras › an order (PED-049): its status, lines, data and history. */
export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string; orderId: string }> }) {
  const { id, orderId } = await params;
  const result = await getPurchase(orderId);
  if (!result || result.order.projectId !== id) notFound();
  return <OrderScreen projectId={id} order={result.order} canManage={result.canManage} />;
}
