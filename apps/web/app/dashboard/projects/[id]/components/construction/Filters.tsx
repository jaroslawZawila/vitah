"use client";

import { useTranslations } from "next-intl";
import { ChevronsDownUp, ChevronsUpDown, Lock } from "lucide-react";
import type { ChapterState } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { filterBox } from "./classes";
import Segmented from "./Segmented";

// Presentational: the filter bars of the Obra pages. Filtering happens in the
// container; these only show and report the choice.

export type StateFilter = "all" | ChapterState;

const bare = "min-h-9 cursor-pointer border-0 bg-transparent font-semibold outline-none pointer-coarse:min-h-11";

const dateInput = "num w-[132px] font-normal max-sm:w-auto max-sm:min-w-0 max-sm:flex-1";

/** A labelled native select inside a filter pill. */
export function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn(filterBox, "max-w-full", className)}>
      <span aria-hidden className="text-muted-foreground">
        {label}
      </span>
      <select id={id} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={cn(bare, "min-w-0 max-w-[260px] truncate pointer-coarse:min-w-11")}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The chapter states as a segmented filter, with how many of each. */
export function StateFilterBar({
  value,
  onChange,
  counts,
  order = ["all", "pending", "in_progress", "finished"],
}: {
  value: StateFilter;
  onChange: (value: StateFilter) => void;
  /** Shown beside each option when given. */
  counts?: Record<StateFilter, number>;
  order?: StateFilter[];
}) {
  const t = useTranslations("construction.filters");
  return (
    <Segmented
      label={t("state")}
      value={value}
      onChange={onChange}
      options={order.map((key) => ({ key, label: t(`states.${key}`), count: counts?.[key] }))}
    />
  );
}

/** From–to dates; either may be empty. `label` names what the dates are of ("Periodo" by default). */
export function PeriodFilter({
  from,
  to,
  onChange,
  label,
}: {
  from: string;
  to: string;
  onChange: (period: { from: string; to: string }) => void;
  label?: string;
}) {
  const t = useTranslations("construction.filters");
  const name = label ?? t("period");
  return (
    <div role="group" aria-label={name} className={cn(filterBox, "flex-wrap")}>
      <span aria-hidden className="text-muted-foreground">
        {name}
      </span>
      {/* The two dates stay on one line: on a phone they take the line under the label, each half of it. */}
      <span className="contents max-sm:flex max-sm:basis-full max-sm:items-center max-sm:gap-2">
        <input
          type="date"
          aria-label={t("from")}
          value={from}
          max={to || undefined}
          onChange={(event) => onChange({ from: event.target.value, to })}
          className={cn(bare, dateInput)}
        />
        <span className="text-muted-foreground">–</span>
        <input
          type="date"
          aria-label={t("to")}
          value={to}
          min={from || undefined}
          onChange={(event) => onChange({ from, to: event.target.value })}
          className={cn(bare, dateInput)}
        />
      </span>
    </div>
  );
}

/** "Desplegar todo" | "Plegar todo" over a list of folding groups; each is off when it would change nothing. */
export function FoldAllButtons({
  allOpen,
  noneOpen,
  onExpand,
  onCollapse,
  className,
}: {
  allOpen: boolean;
  noneOpen: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  className?: string;
}) {
  const t = useTranslations("construction.filters");
  const button = buttonVariants({ variant: "outline", size: "sm" });
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <button type="button" disabled={allOpen} onClick={onExpand} className={button}>
        <ChevronsUpDown aria-hidden />
        {t("expandAll")}
      </button>
      <button type="button" disabled={noneOpen} onClick={onCollapse} className={button}>
        <ChevronsDownUp aria-hidden />
        {t("collapseAll")}
      </button>
    </div>
  );
}

/** "Solo lectura · se actualiza solo". */
export function ReadOnlyNote({ className }: { className?: string }) {
  const t = useTranslations("construction.filters");
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-meta text-muted-foreground", className)}>
      <Lock aria-hidden className="size-3.5" />
      {t("readOnly")}
    </span>
  );
}
