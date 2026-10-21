import { redirect } from "next/navigation";
import { getSuppliers } from "../../../actions/purchase-suppliers";
import SuppliersScreen from "./SuppliersScreen";

/** Compras › Proveedores: every company as a supplier, those owed first. */
export default async function SuppliersPage() {
  const suppliers = await getSuppliers();
  if (!suppliers) redirect("/dashboard");
  return <SuppliersScreen suppliers={suppliers} />;
}
