import { notFound, redirect } from "next/navigation";
import { getInvoiceForm } from "../../../../../actions/purchase-invoices";
import { invoiceHref } from "../../../../projects/[id]/components/purchasing/links";
import InvoiceFormScreen from "../../InvoiceFormScreen";

/** Compras › Facturas › an invoice › Editar. */
export default async function EditInvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const result = await getInvoiceForm({ invoiceId });
  if (!result) notFound();
  if (!result.canManage) redirect(invoiceHref(invoiceId));
  return <InvoiceFormScreen form={result.form} />;
}
