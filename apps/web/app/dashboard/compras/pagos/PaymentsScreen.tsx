"use client";

// Container for Compras › Pagos: what falls due by week, and the payments
// made, a page at a time (`?page=`; a manager may take one back). The views in
// ../components take props only.

import { useTranslations } from "next-intl";
import type { TenantPayments } from "@repo/core/contract";
import { Pager } from "@/components/ui/pager";
import { useListQuery } from "../../components/useListQuery";
import { useConfirm } from "../../components/useConfirm";
import { useVatLabel } from "../../components/vat-basis";
import { usePurchaseFormat } from "../../projects/[id]/components/purchasing/format";
import { PaymentForecast, PaymentTable } from "../components/InvoiceListViews";
import { useRemovePayment } from "./useRemovePayment";

export default function PaymentsScreen({
  payments,
  canManage,
}: {
  payments: TenantPayments;
  canManage: boolean;
}) {
  const t = useTranslations("purchasing.payments");
  const f = usePurchaseFormat();
  const vat = useVatLabel();
  const remove = useConfirm("purchasing.errors");
  const removeRequest = useRemovePayment();
  const list = useListQuery();
  return (
    <div className="flex flex-col gap-[18px]">
      <header className="min-w-0">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="mt-1.5">{t("title")}</h1>
        <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("description")}</p>
      </header>
      <PaymentForecast forecast={payments.forecast} />
      {remove.dialog}
      <PaymentTable
        payments={payments.payments}
        title={t("listTitle")}
        empty={t("none")}
        footer={vat(t("month", { amount: f.money(payments.summary.monthCents), count: payments.summary.monthPayments }), "incl")}
        pending={remove.pending}
        pager={<Pager paging={payments.paging} hrefOf={list.pageHref} />}
        onRemove={
          canManage
            ? (payment) =>
                remove.ask(removeRequest(payment))
            : undefined
        }
      />
    </div>
  );
}
