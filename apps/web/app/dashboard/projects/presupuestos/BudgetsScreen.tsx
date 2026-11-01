"use client";

// Container for Proyectos › Presupuestos: every obra's budget, filtered by
// status and by what is typed. Read-only: a row opens the obra's budget (with
// the other obras beside it) or the project. The views take props only.

import { useDeferredValue, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { BUDGET_FILTERS, budgetFilterCounts, budgetFilterOf, type BudgetFilter, type BudgetOverview } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import Segmented from "../[id]/components/construction/Segmented";
import { SearchFilter } from "../[id]/components/purchasing/Filters";
import BudgetsKpis from "../components/budgets/BudgetsKpis";
import BudgetsTable from "../components/budgets/BudgetsTable";
import { searchBudgets } from "../components/budgets/budgets";
import { budgetHref } from "../[id]/components/budget/links";

const projectHref = (projectId: string) => `/dashboard/projects/${projectId}`;

export default function BudgetsScreen({ overview }: { overview: BudgetOverview }) {
  const t = useTranslations("budgetsOverview");
  const { items, summary } = overview;
  const [filter, setFilter] = useState<BudgetFilter>("all");
  const [query, setQuery] = useState("");
  const searched = useDeferredValue(query);
  const searchedItems = useMemo(() => searchBudgets(items, searched), [items, searched]);
  const counts = budgetFilterCounts(searchedItems);
  const shown = filter === "all" ? searchedItems : searchedItems.filter((i) => budgetFilterOf(i) === filter);

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="min-w-0">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="mt-1.5">{t("title")}</h1>
        <p className="mt-1 max-w-[680px] text-[14px] text-muted-foreground">{t("description")}</p>
      </header>

      <BudgetsKpis summary={summary} />

      <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-label={t("table.label")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3">
          <SearchFilter label={t("search")} value={query} onChange={setQuery} className="max-w-[360px]" />
          <Segmented
            label={t("filterLabel")}
            value={filter}
            onChange={setFilter}
            options={BUDGET_FILTERS.map((key) => ({ key, label: t(`filters.${key}`), count: counts[key] }))}
          />
        </div>
        <BudgetsTable items={shown} budgetHref={(id) => budgetHref(id, "")} projectHref={projectHref} empty={items.length === 0 ? t("none") : t("noMatch")} />
      </section>
      <p className="text-[12px] text-muted-foreground">{t("footnote")}</p>
    </div>
  );
}
