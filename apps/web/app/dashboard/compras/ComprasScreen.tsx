"use client";

// Container for the company-wide Compras page (rail › Red › Compras): the
// orders of every obra, for Administration. Read-only: orders are created and
// changed from their obra. The list is paged and filtered on the server: the
// filters live in the URL (./list-query), and changing one loads its first
// page. The CSV export asks the server for every order the filters keep. The
// views take props only.

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { orderLabel, type PurchaseOrderListItem, type TenantPurchases } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Pager } from "@/components/ui/pager";
import { cn } from "@/lib/utils";
import { exportPurchases } from "../../actions/purchasing";
import { useListQuery, useSearchText } from "../components/useListQuery";
import { FilterSelect, PeriodFilter } from "../projects/[id]/components/construction/Filters";
import Segmented from "../projects/[id]/components/construction/Segmented";
import { CheckFilter, GroupFilter, SearchFilter } from "../projects/[id]/components/purchasing/Filters";
import { orderHref, purchasesHref } from "../projects/[id]/components/purchasing/links";
import OrderList from "../projects/[id]/components/purchasing/OrderList";
import { toCsv } from "../projects/[id]/components/purchasing/orders";
import CompanyKpis from "./components/CompanyKpis";
import SupplierTable from "./components/SupplierTable";
import { hasOrdersFilter, ordersFilters, type OrdersQuery } from "./list-query";

const GROUPS = ["all", "open", "pending", "done", "cancelled"] as const;

/** Saves `text` as a file in the browser. */
function download(name: string, text: string) {
  // A BOM so Excel reads the accents right.
  const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Later: some browsers read the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ComprasScreen({
  purchases,
  query,
}: {
  /** The page of orders (or the suppliers' breakdown) the URL asks for. */
  purchases: TenantPurchases;
  /** The filters as the URL has them. */
  query: OrdersQuery;
}) {
  const t = useTranslations("purchasing.company");
  const tl = useTranslations("purchasing.list");
  const ts = useTranslations("purchasing.status");
  const tk = useTranslations("purchasing.kind");
  const list = useListQuery();
  const [text, setText] = useSearchText(query.query, (q) => list.set({ q }));
  const [exporting, startExport] = useTransition();
  const { orders, today, paging, groupCounts } = purchases;
  const view = query.view;
  const groups = purchases.bySupplier ?? [];
  const empty = hasOrdersFilter(query) ? tl("noMatch") : t("none");
  const nothing = view === "orders" ? paging.total === 0 : groups.length === 0;

  function exportCsv() {
    startExport(async () => {
      // Every order the filters keep, not just this page.
      const all = await exportPurchases(ordersFilters(query));
      const csv = toCsv(
        t.raw("csv") as string[],
        all,
        (o: PurchaseOrderListItem) => [
          o.projectRef,
          orderLabel(o.number),
          tk(o.kind),
          o.supplierName,
          o.description,
          o.chapterCodes.join(" "),
          (o.amountCents / 100).toFixed(2).replace(".", ","),
          o.orderedOn ?? "",
          o.kind === "material" ? (o.expectedOn ?? "") : [o.workStart, o.workEnd].filter(Boolean).join(" – "),
          o.completedOn ?? "",
          ts(o.status),
          o.lateDays ?? "",
        ],
      );
      download(t("csvName", { date: today }), csv);
    });
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1 className="mt-1.5">{t("title")}</h1>
          <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("description")}</p>
        </div>
        <Button type="button" variant="outline" onClick={exportCsv} disabled={nothing || exporting}>
          <Download aria-hidden />
          {t("export")}
        </Button>
      </header>

      <CompanyKpis summary={purchases.summary} today={today} lateRefs={purchases.summary.lateProjectRefs} />

      <section
        className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5", list.pending && "opacity-70")}
        aria-label={t("ordersLabel")}
        aria-busy={list.pending}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3">
          <Segmented
            label={t("view")}
            value={view}
            onChange={(next) => list.set({ vista: next === "suppliers" ? "proveedores" : null })}
            options={(["orders", "suppliers"] as const).map((key) => ({ key, label: t(`views.${key}`) }))}
          />
          <GroupFilter
            value={query.group}
            onChange={(group) => list.set({ estado: group === "all" ? null : group })}
            groups={GROUPS}
            counts={groupCounts}
          />
          <SearchFilter label={t("search")} value={text} onChange={setText} className="max-w-[320px]" />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3.5">
          <FilterSelect
            id="company-project"
            label={t("project")}
            value={query.projectId}
            onChange={(obra) => list.set({ obra })}
            options={[
              { value: "", label: t("allProjects") },
              ...purchases.projects.map((p) => ({ value: p.id, label: `${p.ref} ${p.address}` })),
            ]}
          />
          <FilterSelect
            id="company-supplier"
            label={tl("supplier")}
            value={query.supplierId}
            onChange={(proveedor) => list.set({ proveedor })}
            options={[{ value: "", label: tl("all") }, ...purchases.suppliers.map((s) => ({ value: s.id, label: s.name }))]}
          />
          <FilterSelect
            id="company-kind"
            label={t("kind")}
            value={query.kind}
            onChange={(kind) => list.set({ tipo: kind === "all" ? null : kind })}
            options={[
              { value: "all", label: tl("all") },
              { value: "material", label: tk("material") },
              { value: "subcontract", label: tk("subcontract") },
            ]}
          />
          <PeriodFilter label={t("orderedOn")} from={query.from} to={query.to} onChange={({ from, to }) => list.set({ desde: from, hasta: to })} />
          <CheckFilter id="company-late" label={tl("lateOnly")} checked={query.lateOnly} onChange={(late) => list.set({ retraso: late ? "1" : null })} />
        </div>

        {view === "orders" ? (
          <>
            <OrderList
              orders={orders}
              variant="company"
              orderHref={(o) => orderHref(o.projectId, o.id)}
              projectHref={(o) => purchasesHref(o.projectId)}
              empty={empty}
              totals={{ count: paging.total, contractedCents: purchases.shownContractedCents }}
            />
            <Pager paging={paging} hrefOf={list.pageHref} />
          </>
        ) : (
          <SupplierTable groups={groups} empty={empty} />
        )}
      </section>
    </div>
  );
}
