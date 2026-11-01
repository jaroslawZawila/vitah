"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { budgetSituation, perM2High, type BudgetOverviewItem } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useObraFormat } from "../../[id]/components/obra/format";
import { SearchFilter } from "../../[id]/components/purchasing/Filters";
import ObraPicker from "../ObraPicker";
import BudgetPill from "./BudgetPill";
import { obraOptionsOf, searchBudgets, type Neighbours } from "./budgets";
import { SITUATION_CLASS, useSituationText } from "./situation";

type Props = {
  items: BudgetOverviewItem[];
  currentId: string;
  around: Neighbours;
  /** The page on screen for another obra. */
  hrefOf: (projectId: string) => string;
};

/** "2 de 5", and links to the obras before and after: up/down in the list, left/right in the bar. */
function Steps({ items, around, hrefOf, vertical }: Omit<Props, "currentId"> & { vertical: boolean }) {
  const t = useTranslations("budgetsOverview.switcher");
  const step = cn(buttonVariants({ variant: "outline", size: "icon" }), "pointer-coarse:size-11");
  const [Previous, Next] = vertical ? [ChevronUp, ChevronDown] : [ChevronLeft, ChevronRight];
  // With a single obra there is nowhere to step to.
  if (items.length < 2) return null;
  return (
    <span className="flex items-center gap-1.5">
      <span className="num mr-1 text-[12px] text-muted-foreground">{t("position", { index: around.index + 1, total: items.length })}</span>
      <Link href={hrefOf(around.previous.projectId)} className={step} aria-label={t("previous")} title={t("previousKey")} aria-keyshortcuts="Alt+ArrowUp">
        <Previous aria-hidden />
      </Link>
      <Link href={hrefOf(around.next.projectId)} className={step} aria-label={t("next")} title={t("nextKey")} aria-keyshortcuts="Alt+ArrowDown">
        <Next aria-hidden />
      </Link>
    </span>
  );
}

/** Situations more pressing than a high €/m², which then keep their own flag. */
const PRESSING = ["failed", "expired", "rejected"];

/**
 * Presentational: the obras beside a budget, from 1280px: each with its
 * revision, price and what it waits for, filtered as it is typed into, and
 * up/down to the next. Links to the same page for another obra.
 */
export function BudgetObraList({ items, currentId, around, hrefOf }: Props) {
  const t = useTranslations("budgetsOverview.switcher");
  const f = useObraFormat();
  const words = useSituationText();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => searchBudgets(items, query), [items, query]);

  return (
    <nav aria-label={t("label")} className={cn(cardVariants({ size: "flush" }), "flex min-h-0 flex-col gap-2.5 p-3")}>
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="eyebrow">{t("label")}</span>
        <Steps items={items} around={around} hrefOf={hrefOf} vertical />
      </div>
      <SearchFilter label={t("search")} value={query} onChange={setQuery} className="w-full max-w-none flex-none bg-raise" />
      <ul className="m-0 -mx-1 flex min-h-0 list-none flex-col gap-0.5 overflow-y-auto p-0 px-1">
        {shown.map((item) => {
          const s = budgetSituation(item);
          const high = perM2High(item.revision?.perM2DeltaBp) && !PRESSING.includes(s.kind);
          return (
            <li key={item.projectId}>
              <Link
                href={hrefOf(item.projectId)}
                aria-current={item.projectId === currentId ? "page" : undefined}
                className="flex flex-col gap-0.5 rounded-[10px] border border-transparent px-3 py-2.5 text-[13.5px] transition-colors hover:bg-raise aria-[current=page]:border-primary/30 aria-[current=page]:bg-brand-soft"
              >
                <span className="flex items-center justify-between gap-2">
                  <b className="num text-brand-ink">{item.ref}</b>
                  <BudgetPill item={item} />
                </span>
                <span className="truncate">{item.clientName ?? item.address}</span>
                <span className="flex justify-between gap-2 text-[12.5px]">
                  <span className="num">{item.revision ? f.money(item.revision.totalCents) : "—"}</span>
                  <span className={cn("text-right font-semibold", high ? "text-warn" : SITUATION_CLASS[s.kind])}>
                    {high ? words.perM2High : words.short(s)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="m-0 px-1.5 py-2 text-[13px] text-muted-foreground">{t("noMatch")}</p>}
      <p className="m-0 border-t px-1 pt-2 text-[12px] text-muted-foreground">{t("hint")}</p>
    </nav>
  );
}

/**
 * Presentational: below 1280px, the bar over a budget instead: the obra and a
 * picker for any other, its place in the list and the obras before and after it.
 */
export function BudgetObraBar({ items, currentId, around, hrefOf, onSelect }: Props & { onSelect: (projectId: string) => void }) {
  const options = useMemo(() => obraOptionsOf(items), [items]);
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <ObraPicker options={options} currentId={currentId} onSelect={onSelect} className="min-w-0 flex-1" />
      <Steps items={items} around={around} hrefOf={hrefOf} vertical={false} />
    </div>
  );
}
