"use client";

import { useTranslations } from "next-intl";
import type { PurchaseOrderListItem, SubcontractorDetail } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { orderHref, purchasesHref } from "../../../projects/[id]/components/purchasing/links";
import OrderList from "../../../projects/[id]/components/purchasing/OrderList";

/** Presentational: why a material supplier has no CAE documentation, and how that changes. */
export function NoCaeCard() {
  const t = useTranslations("subcontractors.company.supplier");
  return (
    <section className={cardVariants()} aria-labelledby="no-cae-title">
      <h2 id="no-cae-title">{t("title")}</h2>
      <p className="m-0 text-[13.5px] leading-normal">{t("text")}</p>
      <p className="m-0 text-[12.5px] leading-normal text-muted-foreground">{t("change")}</p>
    </section>
  );
}

/** Presentational: how to reach a supplier. */
export function ContactCard({ company }: { company: SubcontractorDetail }) {
  const t = useTranslations("subcontractors.company.summary");
  const rows: [string, React.ReactNode][] = [
    [t("address"), `${company.address}, ${company.postalCode} ${company.city}`],
    [t("phone"), company.phone && <span className="num">{company.phone}</span>],
    [t("email"), company.email && <a href={`mailto:${company.email}`} className="text-brand-ink hover:text-primary">{company.email}</a>],
    [t("siteContact"), company.siteContact && [company.siteContact, company.siteContactPhone].filter(Boolean).join(" · ")],
  ];
  return (
    <section className={cardVariants()} aria-labelledby="contact-title">
      <h2 id="contact-title">{t("contact")}</h2>
      <dl className="m-0 grid grid-cols-[minmax(90px,35%)_1fr] gap-x-3.5 gap-y-2.5 text-[13.5px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Presentational: the company's orders of material and subcontracts across
 * the obras (Compras); a material supplier's also says why it has no CAE.
 */
export default function OrdersTab({
  company,
  orders,
}: {
  company: SubcontractorDetail;
  orders: PurchaseOrderListItem[];
}) {
  const t = useTranslations("subcontractors.company.orders");
  const list = (
    <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-labelledby="orders-title">
      <h2 id="orders-title" className="px-[18px] pb-2.5">
        {t("title")}
      </h2>
      <OrderList
        orders={orders}
        variant="supplier"
        orderHref={(order) => orderHref(order.projectId, order.id)}
        projectHref={(order) => purchasesHref(order.projectId)}
        empty={t("empty")}
      />
    </section>
  );
  if (!company.suppliesOnly) return list;
  // The list takes the full width: its table needs ~980px, more than a two-thirds column has on a laptop.
  return (
    <div className="flex flex-col gap-4">
      {list}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <NoCaeCard />
        <ContactCard company={company} />
      </div>
    </div>
  );
}
