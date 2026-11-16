"use client";

import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CostRollup } from "./cost-rollup";
import { ChapterContracting, ChapterLabel, LineOrders, type CostChapter } from "./CostTable";
import { useControlFormat } from "./format";
import { Deviation, Figure } from "./SummaryTable";

/** A chapter's (or the obra's) money, labelled: budgeted cost, contracted and the deviation on the closed lines. */
function RollupFigures({ rollup, children }: { rollup: CostRollup; children?: React.ReactNode }) {
  const t = useTranslations("construction.costs");
  const f = useControlFormat();
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm [&_dd]:font-semibold">
      <Figure label={t("cost")}>
        <span className="num">{f.amount(rollup.costCents)}</span>
      </Figure>
      <Figure label={t("contracted")}>
        <span className="num">{rollup.contractedCents === null ? "—" : f.amount(rollup.contractedCents)}</span>
      </Figure>
      <Figure label={t("deviation")}>
        <Deviation cents={rollup.deviationCents} bp={rollup.deviationBp} />
      </Figure>
      {children}
    </dl>
  );
}

/**
 * Presentational, below 768px: Obra › Costes as a card per chapter, its
 * money on screen and its lines folded under it (the same fold as the
 * table's, so "Desplegar todo" and the URL work alike). A line not
 * contracted shows only its cost; an open one what is contracted so far,
 * never a deviation.
 */
export default function CostCards({
  chapters,
  total,
  expanded,
  onToggle,
  orderHref,
  newOrderHref,
  className,
}: {
  chapters: CostChapter[];
  total?: CostRollup;
  expanded: (code: string) => boolean;
  onToggle: (code: string) => void;
  orderHref: (orderId: string) => string;
  newOrderHref?: (chapterCode: string) => string;
  className?: string;
}) {
  const t = useTranslations("construction.costs");
  const f = useControlFormat();

  if (chapters.length === 0) {
    return <p className={cn(cardVariants(), "text-center text-sm text-muted-foreground", className)}>{t("noMatch")}</p>;
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label={t("tableLabel")}>
        {chapters.map((chapter) => {
          const open = expanded(chapter.code);
          const body = `costs-card-${chapter.code}`;
          return (
            <li key={chapter.code} className={cn(cardVariants({ size: "flush" }))}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={body}
                onClick={() => onToggle(chapter.code)}
                className="flex min-h-11 w-full cursor-pointer items-start gap-x-2.5 px-3.5 pt-3 pb-2 text-left"
              >
                <ChevronRight aria-hidden className={cn("mt-0.5 size-4 flex-none text-muted-foreground transition-transform", open && "rotate-90")} />
                <span className="num flex-none font-semibold">{chapter.code}</span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                  <ChapterLabel chapter={chapter} />
                </span>
              </button>
              <div className="px-3.5 pb-3">
                <RollupFigures rollup={chapter.rollup}>
                  <Figure label={t("orders")}>
                    <ChapterContracting chapter={chapter} newOrderHref={newOrderHref} className="flex-wrap font-normal whitespace-normal" />
                  </Figure>
                </RollupFigures>
              </div>
              <div id={body}>
                {open && (
                  <ul className="m-0 list-none border-t bg-raise/40 p-0">
                    {chapter.lines.map((line) => (
                      <li key={line.id} className="flex flex-col gap-2 border-t px-3.5 py-2.5 first:border-t-0">
                        <p className="m-0 text-sm leading-snug">
                          <span className="num mr-2 text-muted-foreground">{line.code}</span>
                          {line.description}
                        </p>
                        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                          <Figure label={t("cost")}>
                            <span className="num">{f.amount(line.costCents)}</span>
                          </Figure>
                          <Figure label={t("contracted")}>
                            {line.contractedCents === null ? (
                              <Badge variant="outline">{t("notContracted")}</Badge>
                            ) : (
                              <span className="num">{f.amount(line.contractedCents)}</span>
                            )}
                          </Figure>
                          {line.contractedCents !== null && (
                            <>
                              <Figure label={t("deviation")}>
                                {line.contracting === "open" ? (
                                  <span className="text-meta text-muted-foreground">{t("noDeviationYet")}</span>
                                ) : (
                                  <Deviation cents={line.deviationCents} bp={line.deviationBp} />
                                )}
                              </Figure>
                              <Figure label={t("orders")} className="col-span-2">
                                <LineOrders line={line} orderHref={orderHref} />
                              </Figure>
                            </>
                          )}
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {total && (
        <div className={cn(cardVariants(), "gap-2.5 p-3.5")}>
          <p className="text-sm font-bold">{t("total", { count: total.lines })}</p>
          <RollupFigures rollup={total} />
        </div>
      )}
    </div>
  );
}
