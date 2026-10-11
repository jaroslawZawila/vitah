"use client";

import Link from "next/link";
import { Check } from "lucide-react";
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
  // Open ones first, so the short list shows what is left.
  const ordered = [...checks.filter((c) => !c.done), ...checks.filter((c) => c.done)];
  const shown = limit ? ordered.slice(0, limit) : ordered;

  return (
    <section className={cardVariants()} aria-labelledby="review-title">
      <div className={cardHead}>
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2 id="review-title">{t("title")}</h2>
        </div>
        {checks.length > 0 && (
          <div className="flex min-w-[220px] items-center gap-2.5">
            <ProgressBar pct={(done * 100) / checks.length} className="flex-1" />
            <span className="font-mono text-[12.5px]">{t("progress", { done, total: checks.length })}</span>
          </div>
        )}
      </div>
      {checks.length === 0 ? (
        <p className={muted}>{t("none")}</p>
      ) : (
        <>
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
                      <Button type="button" size="sm" variant={check.done ? "ghost" : "outline"} className={cn(check.done && "text-good")} onClick={() => onToggle(check)} aria-pressed={check.done}>
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
        </>
      )}
    </section>
  );
}
