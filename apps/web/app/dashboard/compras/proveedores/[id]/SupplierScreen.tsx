"use client";

// Container for a supplier's page in Compras: read-only, it calls no action.
// Its orders, invoices and payments are changed on their own pages; its data
// and CAE on its Subcontratas ficha.

import { useTranslations } from "next-intl";
import type { SupplierPurchasing } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import BackLink from "../../../components/BackLink";
import { orderHref, purchasesHref, SUPPLIERS_HREF } from "../../../projects/[id]/components/purchasing/links";
import OrderList from "../../../projects/[id]/components/purchasing/OrderList";
import { companyHref } from "../../../subcontratas/components/display";
import { InvoiceTable, PaymentTable } from "../../components/InvoiceListViews";
import { SupplierFigures, SupplierHeading } from "../../components/SupplierPurchasingViews";

export default function SupplierScreen({ purchasing }: { purchasing: SupplierPurchasing }) {
  const t = useTranslations("purchasing.suppliers.detail");
  const ts = useTranslations("purchasing.suppliers");
  const { supplier, orders, invoices, payments, today } = purchasing;
  return (
    <div className="flex flex-col gap-[18px]">
      <BackLink href={SUPPLIERS_HREF} />
      <SupplierHeading supplier={supplier} fichaHref={companyHref(supplier.id)} />
      <SupplierFigures supplier={supplier} />

      <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-labelledby="supplier-orders-title">
        <h2 id="supplier-orders-title" className="px-[18px] pb-2.5 text-[22px]">
          {t("orders")} <span className="num text-[16px] text-muted-foreground">{orders.length}</span>
        </h2>
        <OrderList
          orders={orders}
          variant="supplier"
          orderHref={(order) => orderHref(order.projectId, order.id)}
          projectHref={(order) => purchasesHref(order.projectId)}
          empty={t("noOrders")}
        />
      </section>

      <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-labelledby="supplier-invoices-title">
        <h2 id="supplier-invoices-title" className="px-[18px] pb-2.5 text-[22px]">
          {t("invoices")} <span className="num text-[16px] text-muted-foreground">{invoices.length}</span>
        </h2>
        <InvoiceTable invoices={invoices} today={today} empty={t("noInvoices")} />
      </section>

      <PaymentTable payments={payments} title={t("payments")} empty={t("noPayments")} pending={false} />
      <p className="max-w-[860px] text-[12.5px] leading-normal text-muted-foreground">{ts("footnote")}</p>
    </div>
  );
}
