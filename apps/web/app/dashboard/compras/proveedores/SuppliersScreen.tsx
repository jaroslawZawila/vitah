"use client";

// Container for Compras › Proveedores: every Subcontratas company as a
// supplier, with what it was ordered, invoiced, paid and is owed. Read-only:
// it only filters. The views in ../components take props only.

import { useDeferredValue, useState } from "react";
import { useTranslations } from "next-intl";
import type { PurchaseSupplierItem, TenantSuppliers } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import Segmented from "../../projects/[id]/components/construction/Segmented";
import { SearchFilter } from "../../projects/[id]/components/purchasing/Filters";
import { SupplierList, SuppliersKpis } from "../components/SupplierPurchasingViews";

const GROUPS = ["withOrders", "owed", "overdue", "all"] as const;
type Group = (typeof GROUPS)[number];

const inGroup = (supplier: PurchaseSupplierItem, group: Group) =>
  group === "all" ||
  (group === "withOrders" ? supplier.orders > 0 : group === "owed" ? supplier.outstandingCents > 0 : supplier.overdueCents > 0);

export default function SuppliersScreen({ suppliers }: { suppliers: TenantSuppliers }) {
  const t = useTranslations("purchasing.suppliers");
  const [group, setGroup] = useState<Group>("withOrders");
  const [query, setQuery] = useState("");
  const searched = useDeferredValue(query.trim().toLowerCase());
  const all = suppliers.suppliers;
  const matching = all.filter((s) => !searched || s.legalName.toLowerCase().includes(searched));
  const shown = matching.filter((s) => inGroup(s, group));

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="min-w-0">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="mt-1.5">{t("title")}</h1>
        <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("description")}</p>
      </header>

      <SuppliersKpis summary={suppliers.summary} />

      <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-labelledby="suppliers-title">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3.5">
          <h2 id="suppliers-title" className="mr-1.5 text-[22px]">
            {t("list.title")}
          </h2>
          <Segmented
            label={t("groups.label")}
            value={group}
            onChange={setGroup}
            options={GROUPS.map((key) => ({ key, label: t(`groups.${key}`), count: matching.filter((s) => inGroup(s, key)).length }))}
          />
          <SearchFilter label={t("search")} value={query} onChange={setQuery} className="max-w-[320px]" />
        </div>
        <SupplierList suppliers={shown} empty={all.length === 0 ? t("none") : t("noMatch")} />
      </section>
      <p className="max-w-[860px] text-[12.5px] leading-normal text-muted-foreground">{t("footnote")}</p>
    </div>
  );
}
