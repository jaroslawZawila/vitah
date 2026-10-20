import { redirect } from "next/navigation";
import { getInvoiceForm } from "../../../../actions/purchase-invoices";
import { INVOICES_HREF } from "../../../projects/[id]/components/purchasing/links";
import InvoiceFormScreen from "../InvoiceFormScreen";

/** Compras › Facturas › Registrar: an invoice (or, with `?abono=`, a credit note) on `?pedido=`. */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ pedido?: string; abono?: string }> }) {
  const { pedido, abono } = await searchParams;
  const result = await getInvoiceForm({ orderId: pedido });
  if (!result) redirect(INVOICES_HREF);
  if (!result.canManage) redirect(INVOICES_HREF);
  return <InvoiceFormScreen key={`${pedido ?? ""}-${abono ?? ""}`} form={result.form} rectifiesId={abono} />;
}
