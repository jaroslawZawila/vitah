"use client";

import { useTranslations } from "next-intl";
import type { PurchasePayment } from "@repo/core/contract";
import { useFormat } from "@/lib/format";
import { deletePaymentAction } from "../../../actions/purchase-invoices";
import type { ConfirmRequest } from "../../components/useConfirm";

/**
 * What to ask before taking a payment back, and the action that does it: the
 * same on Compras › Pagos and on the invoice's page (each container passes it
 * to its `useConfirm`).
 */
export function useRemovePayment() {
  const t = useTranslations("purchasing.invoice.payments");
  const f = useFormat();
  return (payment: PurchasePayment): ConfirmRequest => ({
    t,
    key: "removeDialog",
    values: {
      amount: f.money(payment.amountCents),
      date: f.date(payment.paidOn),
      invoice: payment.invoiceNumber,
      supplier: payment.supplierName,
    },
    destructive: true,
    action: () => deletePaymentAction(payment.id),
  });
}
