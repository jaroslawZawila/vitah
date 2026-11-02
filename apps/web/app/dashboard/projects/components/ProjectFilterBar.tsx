"use client";

import { useTranslations } from "next-intl";
import { BUDGET_FILTERS, OBRA_FILTERS, type BudgetFilter, type ObraFilter } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FilterSelect } from "../[id]/components/construction/Filters";
import Segmented from "../[id]/components/construction/Segmented";
import { SearchFilter } from "../[id]/components/purchasing/Filters";
import type { ProjectFilters } from "../project-list";

/**
 * Presentational: the Proyectos list's search and its two filters, Presupuesto
 * and Obra, each with its count. Segmented from 640px; on phones a select each
 * (the Obra pages' `FilterSelect`), so no option scrolls out of sight.
 */
export default function ProjectFilterBar({
  filters,
  budgetCounts,
  obraCounts,
  onChange,
  onClear,
}: {
  filters: ProjectFilters;
  budgetCounts: Record<BudgetFilter, number>;
  obraCounts: Record<ObraFilter, number>;
  onChange: (filters: Partial<ProjectFilters>) => void;
  /** Shown while any filter or search is on. */
  onClear: (() => void) | null;
}) {
  const t = useTranslations("projectsPage.filters");

  return (
    <div className="flex flex-col gap-3.5 border-b px-[18px] pt-4 pb-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchFilter label={t("search")} value={filters.query} onChange={(query) => onChange({ query })} className="max-w-[360px]" />
        {onClear && (
          <button type="button" onClick={onClear} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto text-brand-ink")}>
            {t("clear")}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-2.5 sm:gap-x-6 sm:gap-y-3">
        <FilterGroup
          id="projects-budget"
          label={t("budget")}
          value={filters.budget}
          options={BUDGET_FILTERS.map((key) => ({ key, label: t(`budgetOptions.${key}`), count: budgetCounts[key] }))}
          onChange={(budget) => onChange({ budget })}
        />
        <FilterGroup
          id="projects-obra"
          label={t("obra")}
          value={filters.obra}
          options={OBRA_FILTERS.map((key) => ({ key, label: t(`obraOptions.${key}`), count: obraCounts[key] }))}
          onChange={(obra) => onChange({ obra })}
        />
      </div>
    </div>
  );
}

function FilterGroup<K extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: K;
  options: { key: K; label: string; count: number }[];
  onChange: (key: K) => void;
}) {
  const t = useTranslations("projectsPage.filters");
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="eyebrow hidden sm:block" aria-hidden>
        {label}
      </span>
      <Segmented label={label} value={value} options={options} onChange={onChange} className="hidden sm:inline-flex" />
      <FilterSelect
        id={id}
        label={label}
        value={value}
        onChange={(key) => onChange(key as K)}
        options={options.map((o) => ({ value: o.key, label: t("optionCount", { label: o.label, count: o.count }) }))}
        className="sm:hidden"
      />
    </div>
  );
}
