"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { COMPANY_TABS, type CompanyTab } from "./tabs";


/** Presentational: the ficha's sections, with optional counts. */
export default function CompanyTabs({
  tab,
  counts,
  onChange,
}: {
  tab: CompanyTab;
  counts: Partial<Record<CompanyTab, number>>;
  onChange: (tab: CompanyTab) => void;
}) {
  const t = useTranslations("subcontractors.company.tabs");
  return (
    <div role="tablist" aria-label={t("label")} className="-mx-1 flex gap-0.5 overflow-x-auto border-b px-1">
      {COMPANY_TABS.map((key) => {
        const on = key === tab;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={on}
            aria-controls={`panel-${key}`}
            onClick={() => onChange(key)}
            className={cn(
              "-mb-px inline-flex min-h-11 flex-none items-center gap-1.5 border-b-2 border-transparent px-3.5 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              on && "border-primary text-foreground",
            )}
          >
            {t(key)}
            {counts[key] !== undefined && (
              <span className="num rounded-full bg-raise px-1.5 text-[11.5px]">{counts[key]}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
