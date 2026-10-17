"use client";

// Container for the company-wide Compras page (rail › Red › Compras): every
// order of every obra, for Administration. Read-only: orders are created and
// changed from their obra. It filters, and exports the filtered rows as CSV
// in the browser. The views take props only.

import { useDeferredValue, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { orderLabel, type PurchaseOrderListItem, type TenantPurchases } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FilterSelect, PeriodFilter } from "../projects/[id]/components/construction/Filters";
import Segmented from "../projects/[id]/components/construction/Segmented";
import { CheckFilter, GroupFilter, SearchFilter } from "../projects/[id]/components/purchasing/Filters";
import { orderHref, purchasesHref } from "../projects/[id]/components/purchasing/links";
import OrderList from "../projects/[id]/components/purchasing/OrderList";
import {
  NO_ORDER_FILTER,
  bySupplier,
  filterOrders,
  groupCounts,
  suppliersOf,
  toCsv,
  type OrderFilter,
} from "../projects/[id]/components/purchasing/orders";
import CompanyKpis from "./components/CompanyKpis";
import SupplierTable from "./components/SupplierTable";

const GROUPS = ["all", "open", "pending", "done", "cancelled"] as const;

type View = "orders" | "suppliers";

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

export default function ComprasScreen({ purchases }: { purchases: TenantPurchases }) {
  const t = useTranslations("purchasing.company");
  const tl = useTranslations("purchasing.list");
  const ts = useTranslations("purchasing.status");
  const tk = useTranslations("purchasing.kind");
  const [view, setView] = useState<View>("orders");
  const [filter, setFilter] = useState<OrderFilter>(NO_ORDER_FILTER);
  const set = (patch: Partial<OrderFilter>) => setFilter((current) => ({ ...current, ...patch }));
  // The search box apart, deferred: typing stays responsive however many orders there are.
  const [query, setQuery] = useState("");
  const searched = useDeferredValue(query);
  const { orders, today } = purchases;

  const { shown, counts } = useMemo(() => {
    const applied = { ...filter, query: searched };
    return { shown: filterOrders(orders, applied), counts: groupCounts(filterOrders(orders, applied, true)) };
  }, [orders, filter, searched]);
  const suppliers = useMemo(() => suppliersOf(orders), [orders]);
  const groups = useMemo(() => (view === "suppliers" ? bySupplier(shown) : []), [view, shown]);
  const lateRefs = useMemo(
    () => [...new Set(orders.filter((o) => o.lateDays !== null).map((o) => o.projectRef))].sort(),
    [orders],
  );
  const empty = orders.length === 0 ? t("none") : tl("noMatch");

  function exportCsv() {
    const csv = toCsv(
      t.raw("csv") as string[],
      shown,
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
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1 className="mt-1.5">{t("title")}</h1>
          <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("description")}</p>
        </div>
        <Button type="button" variant="outline" onClick={exportCsv} disabled={shown.length === 0}>
          <Download aria-hidden />
          {t("export")}
        </Button>
      </header>

      <CompanyKpis summary={purchases.summary} today={today} lateRefs={lateRefs} />

      <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-label={t("ordersLabel")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3">
          <Segmented
            label={t("view")}
            value={view}
            onChange={setView}
            options={(["orders", "suppliers"] as const).map((key) => ({ key, label: t(`views.${key}`) }))}
          />
          <GroupFilter value={filter.group} onChange={(group) => set({ group })} groups={GROUPS} counts={counts} />
          <SearchFilter label={t("search")} value={query} onChange={setQuery} className="max-w-[320px]" />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3.5">
          <FilterSelect
            id="company-project"
            label={t("project")}
            value={filter.projectId}
            onChange={(projectId) => set({ projectId })}
            options={[
              { value: "", label: t("allProjects") },
              ...purchases.projects.map((p) => ({ value: p.id, label: `${p.ref} ${p.address}` })),
            ]}
          />
          <FilterSelect
            id="company-supplier"
            label={tl("supplier")}
            value={filter.supplierId}
            onChange={(supplierId) => set({ supplierId })}
            options={[{ value: "", label: tl("all") }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
          />
          <FilterSelect
            id="company-kind"
            label={t("kind")}
            value={filter.kind}
            onChange={(kind) => set({ kind: kind as OrderFilter["kind"] })}
            options={[
              { value: "all", label: tl("all") },
              { value: "material", label: tk("material") },
              { value: "subcontract", label: tk("subcontract") },
            ]}
          />
          <PeriodFilter label={t("orderedOn")} from={filter.from} to={filter.to} onChange={(period) => set(period)} />
          <CheckFilter id="company-late" label={tl("lateOnly")} checked={filter.lateOnly} onChange={(lateOnly) => set({ lateOnly })} />
        </div>

        {view === "orders" ? (
          <OrderList
            orders={shown}
            variant="company"
            orderHref={(o) => orderHref(o.projectId, o.id)}
            projectHref={(o) => purchasesHref(o.projectId)}
            empty={empty}
          />
        ) : (
          <SupplierTable groups={groups} empty={empty} />
        )}
      </section>
    </div>
  );
}
