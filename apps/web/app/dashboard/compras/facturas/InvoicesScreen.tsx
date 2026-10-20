"use client";

// Container for Compras › Facturas: every supplier invoice of the company,
// owed first. Read-only, it only filters; invoices are registered on their
// own form. The views in ../components take props only.

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { orderLabel, type PurchaseInvoiceListItem, type TenantInvoices } from "@repo/core/contract";
import { isOwed } from "@repo/core/purchase-calc";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FilterSelect } from "../../projects/[id]/components/construction/Filters";
import Segmented from "../../projects/[id]/components/construction/Segmented";
import { SearchFilter } from "../../projects/[id]/components/purchasing/Filters";
import { suppliersOf } from "../../projects/[id]/components/purchasing/orders";
import { newInvoiceHref } from "../../projects/[id]/components/purchasing/links";
import { InvoiceKpis, InvoiceTable } from "../components/InvoiceListViews";

const GROUPS = ["all", "open", "overdue", "paid", "credit"] as const;
type Group = (typeof GROUPS)[number];

const inGroup = (invoice: PurchaseInvoiceListItem, group: Group) =>
  group === "all" || (group === "open" ? isOwed(invoice.state) : invoice.state === group);

export default function InvoicesScreen({ invoices, canManage }: { invoices: TenantInvoices; canManage: boolean }) {
  const t = useTranslations("purchasing.invoices");
  const [group, setGroup] = useState<Group>("all");
  const [projectId, setProjectId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [query, setQuery] = useState("");
  const searched = useDeferredValue(query.trim().toLowerCase());
  const all = invoices.invoices;

  const suppliers = useMemo(() => suppliersOf(all), [all]);
  const filtered = all.filter(
    (i) =>
      (!projectId || i.projectId === projectId) &&
      (!supplierId || i.subcontractorId === supplierId) &&
      (!searched ||
        [i.number, i.supplierName, i.orderDescription, orderLabel(i.orderNumber), i.projectRef].some((text) => text.toLowerCase().includes(searched))),
  );
  const shown = filtered.filter((i) => inGroup(i, group));

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1 className="mt-1.5">{t("title")}</h1>
          <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("description")}</p>
        </div>
        {canManage && (
          <Link href={newInvoiceHref()} className={cn(buttonVariants(), "w-full sm:w-auto")}>
            <Plus aria-hidden />
            {t("new")}
          </Link>
        )}
      </header>

      <InvoiceKpis summary={invoices.summary} />

      <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-labelledby="invoices-title">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3">
          <h2 id="invoices-title" className="mr-1.5 text-[22px]">
            {t("tableTitle")}
          </h2>
          <Segmented
            label={t("groups.label")}
            value={group}
            onChange={setGroup}
            options={GROUPS.map((key) => ({ key, label: t(`groups.${key}`), count: filtered.filter((i) => inGroup(i, key)).length }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3.5">
          <FilterSelect
            id="invoices-project"
            label={t("project")}
            value={projectId}
            onChange={setProjectId}
            options={[{ value: "", label: t("allProjects") }, ...invoices.projects.map((p) => ({ value: p.id, label: `${p.ref} ${p.address}` }))]}
          />
          <FilterSelect
            id="invoices-supplier"
            label={t("supplier")}
            value={supplierId}
            onChange={setSupplierId}
            options={[{ value: "", label: t("allSuppliers") }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
          />
          <SearchFilter label={t("search")} value={query} onChange={setQuery} className="max-w-[320px]" />
        </div>
        <InvoiceTable invoices={shown} today={invoices.today} empty={all.length === 0 ? t("none") : t("noMatch")} />
      </section>
    </div>
  );
}
