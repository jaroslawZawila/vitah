import { notFound } from "next/navigation";
import { getSupplierPurchasing } from "../../../../actions/purchase-suppliers";
import SupplierScreen from "./SupplierScreen";

/** Compras › a supplier: its figures, orders across the obras, invoices and payments. */
export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const purchasing = await getSupplierPurchasing(id);
  if (!purchasing) notFound();
  return <SupplierScreen purchasing={purchasing} />;
}
