"use client";

// Container for the project's Compras tab: read-only, it only filters (the
// orders are written on their own pages). The views in
// ../components/purchasing take props only.

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import type { ProjectPurchases, PurchaseOrderListItem } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FilterSelect } from "../components/construction/Filters";
import { StageEyebrow, type ObraHeader } from "../components/construction/ObraFrame";
import { CheckFilter, GroupFilter } from "../components/purchasing/Filters";
import { newOrderHref, orderHref } from "../components/purchasing/links";
import OrderList from "../components/purchasing/OrderList";
import { NO_ORDER_FILTER, filterOrders, groupCounts, suppliersOf, type OrderFilter } from "../components/purchasing/orders";
import ProjectKpis from "../components/purchasing/ProjectKpis";
import UpcomingCard from "../components/purchasing/UpcomingCard";

const GROUPS = ["all", "open", "pending", "done"] as const;

/** The obra's orders of material and subcontracts, what they contract and what to order next. */
export default function PurchasesScreen({
  projectId,
  header,
  chapters,
  purchases,
  canManage,
}: {
  projectId: string;
  header: ObraHeader;
  /** The contract's chapters, to name the chapter filter's options. */
  chapters: { code: string; name: string }[];
  purchases: ProjectPurchases;
  canManage: boolean;
}) {
  const t = useTranslations("purchasing.project");
  const tl = useTranslations("purchasing.list");
  const [filter, setFilter] = useState<OrderFilter>(NO_ORDER_FILTER);
  const set = (patch: Partial<OrderFilter>) => setFilter((current) => ({ ...current, ...patch }));
  const { orders } = purchases;

  const shown = filterOrders(orders, filter);
  const counts = groupCounts(filterOrders(orders, filter, true));
  const late = orders.filter((o) => o.lateDays !== null).sort((a, b) => (b.lateDays ?? 0) - (a.lateDays ?? 0));
  const href = (order: PurchaseOrderListItem) => orderHref(projectId, order.id);
  const names = new Map(chapters.map((c) => [c.code, c.name]));
  const chapterCodes = [...new Set(orders.flatMap((o) => o.chapterCodes))].sort();

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <StageEyebrow label={header.ref} stage={header.stage} />
          <h1 className="mt-1.5">{t("title")}</h1>
          <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("description")}</p>
        </div>
        {canManage && (
          <Link href={newOrderHref(projectId)} className={cn(buttonVariants(), "w-full sm:w-auto")}>
            <Plus aria-hidden />
            {t("new")}
          </Link>
        )}
      </header>

      <ProjectKpis summary={purchases.summary} late={late} orderHref={href} />

      <div className="grid items-start gap-[18px] lg:grid-cols-3">
        <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5 lg:col-span-2")} aria-labelledby="orders-title">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3.5">
            <h2 id="orders-title" className="mr-1.5 text-[22px]">
              {t("orders")}
            </h2>
            <GroupFilter value={filter.group} onChange={(group) => set({ group })} groups={GROUPS} counts={counts} />
            <FilterSelect
              id="orders-supplier"
              label={tl("supplier")}
              value={filter.supplierId}
              onChange={(supplierId) => set({ supplierId })}
              options={[{ value: "", label: tl("all") }, ...suppliersOf(orders).map((s) => ({ value: s.id, label: s.name }))]}
            />
            <FilterSelect
              id="orders-chapter"
              label={tl("chapterFilter")}
              value={filter.chapter}
              onChange={(chapter) => set({ chapter })}
              options={[
                { value: "", label: tl("all") },
                ...chapterCodes.map((code) => ({ value: code, label: names.has(code) ? `${code} ${names.get(code)}` : code })),
              ]}
            />
            <CheckFilter id="orders-late" label={tl("lateOnly")} checked={filter.lateOnly} onChange={(lateOnly) => set({ lateOnly })} />
          </div>
          <OrderList
            orders={shown}
            variant="project"
            orderHref={href}
            empty={orders.length === 0 ? t("none") : tl("noMatch")}
          />
        </section>

        <UpcomingCard
          upcoming={purchases.upcoming}
          planningMock={purchases.sources.planning === "mock"}
          orderHref={(orderId) => orderHref(projectId, orderId)}
          newOrderHref={canManage ? (code) => newOrderHref(projectId, code) : undefined}
        />
      </div>

      <p className="max-w-[860px] text-[12.5px] leading-normal text-muted-foreground">
        {t.rich("footnote", { b: (chunks) => <b className="text-foreground">{chunks}</b> })}
      </p>
    </div>
  );
}
