"use client";

// Container for Compras › Facturas: the supplier invoices of the company,
// owed first. Read-only; invoices are registered on their own form. The list
// is paged and filtered on the server: the filters live in the URL
// (../list-query), and changing one loads its first page. The views in
// ../components take props only.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import type { TenantInvoices } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Pager } from "@/components/ui/pager";
import { cn } from "@/lib/utils";
import { useListQuery, useSearchText } from "../../components/useListQuery";
import { FilterSelect } from "../../projects/[id]/components/construction/Filters";
import Segmented from "../../projects/[id]/components/construction/Segmented";
import { SearchFilter } from "../../projects/[id]/components/purchasing/Filters";
import { newInvoiceHref } from "../../projects/[id]/components/purchasing/links";
import { InvoiceKpis, InvoiceTable } from "../components/InvoiceListViews";
import { hasInvoicesFilter, type InvoicesQuery } from "../list-query";

const GROUPS = ["all", "open", "overdue", "paid", "credit"] as const;

export default function InvoicesScreen({
  invoices,
  canManage,
  query,
}: {
  /** The page of invoices the URL asks for. */
  invoices: TenantInvoices;
  canManage: boolean;
  /** The filters as the URL has them. */
  query: InvoicesQuery;
}) {
  const t = useTranslations("purchasing.invoices");
  const list = useListQuery();
  const [text, setText] = useSearchText(query.query, (q) => list.set({ q }));

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

      <section
        className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5", list.pending && "opacity-70")}
        aria-labelledby="invoices-title"
        aria-busy={list.pending}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3">
          <h2 id="invoices-title" className="mr-1.5 text-[22px]">
            {t("tableTitle")}
          </h2>
          <Segmented
            label={t("groups.label")}
            value={query.group}
            onChange={(group) => list.set({ estado: group === "all" ? null : group })}
            options={GROUPS.map((key) => ({ key, label: t(`groups.${key}`), count: invoices.groupCounts[key] }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3.5">
          <FilterSelect
            id="invoices-project"
            label={t("project")}
            value={query.projectId}
            onChange={(obra) => list.set({ obra })}
            options={[{ value: "", label: t("allProjects") }, ...invoices.projects.map((p) => ({ value: p.id, label: `${p.ref} ${p.address}` }))]}
          />
          <FilterSelect
            id="invoices-supplier"
            label={t("supplier")}
            value={query.supplierId}
            onChange={(proveedor) => list.set({ proveedor })}
            options={[{ value: "", label: t("allSuppliers") }, ...invoices.suppliers.map((s) => ({ value: s.id, label: s.name }))]}
          />
          <SearchFilter label={t("search")} value={text} onChange={setText} className="max-w-[320px]" />
        </div>
        <InvoiceTable invoices={invoices.invoices} today={invoices.today} empty={hasInvoicesFilter(query) ? t("noMatch") : t("none")} />
        <Pager paging={invoices.paging} hrefOf={list.pageHref} />
      </section>
    </div>
  );
}
