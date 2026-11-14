import { notFound } from "next/navigation";
import { forbidden } from "@/lib/access";
import { getInvoiceForm } from "../../../../../actions/purchase-invoices";
import InvoiceFormScreen from "../../InvoiceFormScreen";

/** Compras › Facturas › an invoice › Editar. */
export default async function EditInvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const result = await getInvoiceForm({ invoiceId });
  if (!result) notFound();
  if (!result.canManage) forbidden();
  return <InvoiceFormScreen form={result.form} />;
}
