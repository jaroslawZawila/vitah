"use client";

import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterBox } from "../construction/classes";
import Segmented from "../construction/Segmented";
import type { OrderGroup } from "./orders";

// Presentational: the Compras lists' filter controls. Filtering happens in the
// container; these only show and report the choice.

/** A checkbox filter ("Solo con retraso"). */
export function CheckFilter({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-[13px] pointer-coarse:min-h-11">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-[18px] accent-primary"
      />
      {label}
    </label>
  );
}

/** A search box in a filter bar. */
export function SearchFilter({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={cn(filterBox, "min-w-0 flex-[1_1_220px] text-muted-foreground", className)}>
      <Search aria-hidden className="size-4 flex-none" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="min-h-9 w-full min-w-0 bg-transparent text-foreground outline-none pointer-coarse:min-h-11"
      />
    </label>
  );
}

/** The orders' state as a segmented filter (Todos · Abiertos · Sin enviar · Cerrados [· Cancelados]), with counts. */
export function GroupFilter({
  value,
  onChange,
  groups,
  counts,
}: {
  value: "all" | OrderGroup;
  onChange: (value: "all" | OrderGroup) => void;
  groups: readonly ("all" | OrderGroup)[];
  counts?: Record<"all" | OrderGroup, number>;
}) {
  const t = useTranslations("purchasing.groups");
  return (
    <Segmented
      label={t("label")}
      value={value}
      onChange={onChange}
      options={groups.map((key) => ({ key, label: t(key), count: counts?.[key] }))}
    />
  );
}
