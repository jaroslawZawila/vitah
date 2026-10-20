import { notFound } from "next/navigation";
import { getInvoice } from "../../../../actions/purchase-invoices";
import InvoiceScreen from "./InvoiceScreen";

/** Compras › Facturas › an invoice: its amounts, payments, PDF versions and history. */
export default async function InvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const result = await getInvoice(invoiceId);
  if (!result) notFound();
  return <InvoiceScreen invoice={result.invoice} canManage={result.canManage} />;
}
