"use client";

// Container for Compras › Pagos: what falls due by week, and the payments
// made (a manager may take one back). The views in ../components take props only.

import { useTranslations } from "next-intl";
import type { TenantPayments } from "@repo/core/contract";
import { deletePaymentAction } from "../../../actions/purchase-invoices";
import FormError from "../../components/FormError";
import { useObraAction } from "../../projects/[id]/components/obra/useObraAction";
import { usePurchaseFormat } from "../../projects/[id]/components/purchasing/format";
import { PaymentForecast, PaymentTable } from "../components/InvoiceListViews";

export default function PaymentsScreen({
  payments,
  canManage,
}: {
  payments: TenantPayments;
  canManage: boolean;
}) {
  const t = useTranslations("purchasing.payments");
  const tr = useTranslations("purchasing.invoice.payments");
  const f = usePurchaseFormat();
  const remove = useObraAction();
  return (
    <div className="flex flex-col gap-[18px]">
      <header className="min-w-0">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="mt-1.5">{t("title")}</h1>
        <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("description")}</p>
      </header>
      <PaymentForecast forecast={payments.forecast} />
      <FormError namespace="purchasing.errors" error={remove.state?.error} />
      <PaymentTable
        payments={payments.payments}
        title={t("listTitle")}
        empty={t("none")}
        footer={t("month", { amount: f.money(payments.summary.monthCents), count: payments.summary.monthPayments })}
        pending={remove.pending}
        onRemove={
          canManage
            ? (payment) =>
                remove.confirmThen(tr("confirmRemove", { amount: f.money(payment.amountCents) }), () =>
                  deletePaymentAction(payment.id),
                )
            : undefined
        }
      />
    </div>
  );
}
