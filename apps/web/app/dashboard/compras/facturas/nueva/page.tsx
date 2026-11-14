import { notFound } from "next/navigation";
import { forbidden } from "@/lib/access";
import { getInvoiceForm } from "../../../../actions/purchase-invoices";
import InvoiceFormScreen from "../InvoiceFormScreen";

/** Compras › Facturas › Registrar: an invoice (or, with `?abono=`, a credit note) on `?pedido=`. */
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ pedido?: string; abono?: string }> }) {
  const { pedido, abono } = await searchParams;
  const result = await getInvoiceForm({ orderId: pedido });
  if (!result) notFound();
  if (!result.canManage) forbidden();
  return <InvoiceFormScreen key={`${pedido ?? ""}-${abono ?? ""}`} form={result.form} rectifiesId={abono} />;
}
