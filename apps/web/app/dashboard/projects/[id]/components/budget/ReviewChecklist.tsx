"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BudgetCheck } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { cardHead, muted } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import ProgressBar from "../obra/ProgressBar";

const KIND_VARIANT = { inconsistency: "warn", assumption: "info", estimated: "yel", ratio: "outline" } as const;
const KINDS = ["inconsistency", "assumption", "estimated", "ratio"] as const;

/**
 * Presentational: the "Antes de emitir" checklist: what the AI flagged, the
 * lines it priced outside the price base and chapters off the usual €/m².
 * `onToggle` (drafts) ticks an item; `hrefOf` links an item to its line or chapter.
 * Once every item is reviewed (or there are none) it folds into one row; the
 * list can be opened again, and ticking the last open item folds it back.
 */
export default function ReviewChecklist({
  checks,
  limit,
  allHref,
  hrefOf,
  onToggle,
}: {
  checks: BudgetCheck[];
  /** Show the first open items only, with a link to the rest. */
  limit?: number;
  allHref?: string;
  hrefOf: (check: BudgetCheck) => string | null;
  onToggle?: (check: BudgetCheck) => void;
}) {
  const t = useTranslations("budget.review");
  const f = useObraFormat();
  const done = checks.filter((c) => c.done).length;
  const open = checks.length - done;
  // Whether the user opened the all-reviewed list; it folds again whenever the
  // last open item is cleared (ticked, or gone after an edit).
  const [unfolded, setUnfolded] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open === 0) setUnfolded(false);
  }
  // Folding swaps the card's contents, so keep focus on its toggle.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    // Waits for the toggle to exist: after a tick it appears once the save lands.
    if (!refocus.current || !toggleRef.current) return;
    toggleRef.current.focus();
    refocus.current = false;
  });
  const fold = (next: boolean) => {
    refocus.current = true;
    setUnfolded(next);
  };

  if (checks.length === 0 || (open === 0 && !unfolded)) {
    return (
      <section className={cn(cardVariants(), "flex-row flex-wrap items-center gap-x-3.5 gap-y-3 py-3")} aria-labelledby="review-title">
        <span className="grid size-[30px] flex-none place-items-center rounded-full bg-good-soft text-good">
          <Check size={16} strokeWidth={2.6} aria-hidden />
        </span>
        <div className="min-w-0 flex-[1_1_220px]">
          <h2 id="review-title">{t(checks.length ? "allDone" : "noneTitle")}</h2>
          <p className={muted}>{checks.length ? t("allDoneHint", { count: checks.length }) : t("none")}</p>
        </div>
        {checks.length > 0 && (
          <Button ref={toggleRef} type="button" variant="outline" size="sm" className="max-sm:w-full" aria-expanded={false} onClick={() => fold(true)}>
            {t("expand", { count: checks.length })} <ChevronDown aria-hidden />
          </Button>
        )}
      </section>
    );
  }

  // Open ones first, so the short list shows what is left.
  const ordered = [...checks.filter((c) => !c.done), ...checks.filter((c) => c.done)];
  const shown = limit ? ordered.slice(0, limit) : ordered;
  const toggle = (check: BudgetCheck) => {
    // Ticking the last open item folds the card: its toggle takes the focus.
    if (!check.done && open === 1) refocus.current = true;
    onToggle?.(check);
  };

  return (
    <section className={cardVariants()} aria-labelledby="review-title">
      <div className={cardHead}>
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2 id="review-title">{t("title")}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex min-w-[220px] items-center gap-2.5">
            <ProgressBar pct={(done * 100) / checks.length} className="flex-1" />
            <span className="font-mono text-[12.5px]">{t("progress", { done, total: checks.length })}</span>
          </div>
          {open === 0 && (
            <Button ref={toggleRef} type="button" variant="outline" size="sm" aria-expanded onClick={() => fold(false)}>
              {t("collapse")} <ChevronUp aria-hidden />
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((kind) => {
          const count = checks.filter((c) => c.kind === kind).length;
          return count > 0 && <Badge key={kind} variant={KIND_VARIANT[kind]}>{t(`counts.${kind}`, { count })}</Badge>;
        })}
      </div>
      <ul>
        {shown.map((check) => {
          const href = hrefOf(check);
          return (
            <li key={check.key} className="flex flex-wrap items-start gap-3 border-t py-3 text-[13.5px] md:flex-nowrap">
              <Badge variant={KIND_VARIANT[check.kind]} className="min-w-[104px]">
                {t(`kinds.${check.kind}`)}
              </Badge>
              <div className={cn("min-w-0 flex-1", check.done && "text-muted-foreground")}>
                <p className="font-semibold">{check.title}</p>
                <p className="text-muted-foreground">
                  {check.kind === "ratio"
                    ? t("ratioDetail", { perM2: f.money(check.perM2Cents ?? 0), average: f.money(check.averageCents ?? 0) })
                    : check.detail}
                </p>
              </div>
              <span className="flex flex-none gap-1.5">
                {href && (
                  <Link href={href} className="inline-flex min-h-8 items-center px-2 text-[12.5px] font-semibold text-brand-ink hover:underline pointer-coarse:min-h-11">
                    {t("go", { ref: check.ref ?? "" })}
                  </Link>
                )}
                {onToggle ? (
                  <Button type="button" size="sm" variant={check.done ? "ghost" : "outline"} className={cn(check.done && "text-good")} onClick={() => toggle(check)} aria-pressed={check.done}>
                    {check.done ? <><Check aria-hidden /> {t("done")}</> : t("mark")}
                  </Button>
                ) : (
                  check.done && <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-good"><Check size={14} aria-hidden /> {t("done")}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {limit && checks.length > limit && allHref && (
        <Link href={allHref} className="border-t pt-2.5 text-sm font-semibold text-brand-ink hover:underline">
          {t("all", { count: checks.length })}
        </Link>
      )}
    </section>
  );
}
