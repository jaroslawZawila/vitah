"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { orderLabel, type ConstructionCosts, type CostLine } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { Table, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { touchLink } from "../../../../components/touch";
import type { CostRollup } from "./cost-rollup";
import FoldRow from "./FoldRow";
import { deviationTone, useControlFormat } from "./format";
import { ChapterStatePill, Dot } from "./pills";

/** The orders that contract a line, each linked; a late delivery flagged. */
export function LineOrders({ line, orderHref }: { line: CostLine; orderHref: (orderId: string) => string }) {
  const t = useTranslations("construction.costs");
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-meta">
      {line.orders.map((order) => (
        <li key={order.id} className="flex flex-wrap items-center gap-x-1.5">
          <Link href={orderHref(order.id)} className={cn("num font-medium text-brand-ink hover:text-primary", touchLink)}>
            {orderLabel(order.number)}
          </Link>
          <span>{order.supplierName}</span>
          {order.lateDays !== null && (
            <Badge variant="warn" className="px-2 py-px">
              <Dot />
              {t("late")}
            </Badge>
          )}
        </li>
      ))}
      {line.contracting === "open" && (
        <li>
          <Badge className="px-2 py-px">
            <Dot />
            {t("openLine")}
          </Badge>
        </li>
      )}
    </ul>
  );
}

export type CostChapter = ConstructionCosts["chapters"][number] & { rollup: CostRollup };

/** A folded chapter's name, its line count and what needs a look (in progress, overruns, late deliveries). */
export function ChapterLabel({ chapter }: { chapter: CostChapter }) {
  const t = useTranslations("construction.costs");
  const { rollup } = chapter;
  return (
    <>
      <b className="min-w-0">{chapter.name}</b>
      <span className="text-meta text-muted-foreground">{t("lineCount", { count: rollup.lines })}</span>
      {chapter.state === "in_progress" && <ChapterStatePill state={chapter.state} />}
      {rollup.overruns > 0 && (
        <Badge variant="destructive" className="px-2 py-px">
          <Dot />
          {t("overruns", { count: rollup.overruns })}
        </Badge>
      )}
      {rollup.lateOrders > 0 && (
        <Badge variant="warn" className="px-2 py-px">
          <Dot />
          {t("lateOrders", { count: rollup.lateOrders })}
        </Badge>
      )}
    </>
  );
}

/** How far a chapter's lines are contracted: a bar, "3 of 7 closed · 1 open", and "Pedir" while nothing is. */
export function ChapterContracting({
  chapter,
  newOrderHref,
  className,
}: {
  chapter: CostChapter;
  newOrderHref?: (chapterCode: string) => string;
  className?: string;
}) {
  const t = useTranslations("construction.costs");
  const { closed, open } = chapter.rollup;
  const share = (n: number) => `${(n / (chapter.lines.length || 1)) * 100}%`;
  return (
    <span className={cn("flex items-center gap-x-2 text-meta whitespace-nowrap text-muted-foreground", className)}>
      <span aria-hidden className="relative flex h-1.5 w-12 flex-none overflow-hidden rounded-full bg-border">
        <span className="bg-primary" style={{ width: share(closed) }} />
        <span className="bg-primary/40" style={{ width: share(open) }} />
      </span>
      <span>
        {t("closedOf", { closed, total: chapter.lines.length })}
        {open > 0 && ` · ${t("openCount", { count: open })}`}
      </span>
      {newOrderHref && closed + open === 0 && (
        <Link
          href={newOrderHref(chapter.code)}
          onClick={(event) => event.stopPropagation()}
          className={cn("font-semibold text-brand-ink hover:text-primary pointer-coarse:justify-center", touchLink)}
        >
          {t("order")}
        </Link>
      )}
    </span>
  );
}

/** A chapter's (or the obra's) figures folded: its cost, what is contracted, `orders`, its deviation and its share. */
function RollupCells({ rollup, orders }: { rollup: CostRollup; orders?: ReactNode }) {
  const f = useControlFormat();
  return (
    <>
      <TableCell className="num text-right font-semibold">{f.amount(rollup.costCents)}</TableCell>
      <TableCell className="num text-right font-semibold">
        {rollup.contractedCents === null ? "—" : f.amount(rollup.contractedCents)}
      </TableCell>
      <TableCell className="whitespace-normal">{orders}</TableCell>
      <TableCell className={cn("num text-right font-semibold", deviationTone(rollup.deviationCents))}>
        {rollup.deviationCents === null ? "—" : f.signedAmount(rollup.deviationCents)}
      </TableCell>
      <TableCell className={cn("num pr-[18px] text-right font-semibold", deviationTone(rollup.deviationCents))}>
        {rollup.deviationBp !== null && f.signedPercent(rollup.deviationBp)}
      </TableCell>
    </>
  );
}

/**
 * Presentational: cost per budget line, chapter by chapter. Each chapter is
 * one row with its lines' totals, how many are closed, and what needs a look
 * (overruns, late deliveries, a chapter in progress); it folds open on its
 * lines: what we expected to pay against what Compras contracted, and the
 * orders behind it. A line not contracted yet shows only its cost, never a
 * zero; an open line (more still to order) shows what is contracted so far,
 * never a deviation.
 */
export default function CostTable({
  chapters,
  total,
  expanded,
  onToggle,
  orderHref,
  newOrderHref,
}: {
  /** The chapters and lines to show (already filtered), each with its lines' totals. */
  chapters: CostChapter[];
  /** The obra's totals, shown only while nothing is filtered out. */
  total?: CostRollup;
  expanded: (code: string) => boolean;
  onToggle: (code: string) => void;
  orderHref: (orderId: string) => string;
  /** "Pedir" on a chapter nothing is contracted for. */
  newOrderHref?: (chapterCode: string) => string;
}) {
  const t = useTranslations("construction.costs");
  const f = useControlFormat();

  return (
    // From 768px; below it, CostCards.
    <section className={cn(cardVariants({ size: "flush" }), "hidden py-1.5 md:flex")} aria-label={t("tableLabel")}>
      {chapters.length === 0 ? (
        <p className="px-[18px] py-6 text-center text-sm text-muted-foreground">{t("noMatch")}</p>
      ) : (
        <Table className="min-w-[940px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-[18px]">{t("line")}</TableHead>
              <TableHead>{t("descriptionCol")}</TableHead>
              <TableHead className="text-right">{t("cost")}</TableHead>
              <TableHead className="text-right">{t("contracted")}</TableHead>
              <TableHead>{t("orders")}</TableHead>
              <TableHead className="text-right">{t("deviation")}</TableHead>
              <TableHead className="pr-[18px] text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          {chapters.map((chapter) => {
            const open = expanded(chapter.code);
            const { rollup } = chapter;
            const body = `costs-chapter-${chapter.code}`;
            return (
              <Fragment key={chapter.code}>
                <tbody>
                  <FoldRow
                    code={chapter.code}
                    open={open}
                    controls={body}
                    onToggle={() => onToggle(chapter.code)}
                    colSpan={2}
                    label={<ChapterLabel chapter={chapter} />}
                  >
                    <RollupCells rollup={rollup} orders={<ChapterContracting chapter={chapter} newOrderHref={newOrderHref} />} />
                  </FoldRow>
                </tbody>
                <tbody id={body}>
                  {open &&
                    chapter.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="num pl-[18px] text-muted-foreground">{line.code}</TableCell>
                        <TableCell className="min-w-[240px] whitespace-normal">{line.description}</TableCell>
                        <TableCell className="num text-right">{f.amount(line.costCents)}</TableCell>
                        {line.contractedCents === null ? (
                          <>
                            <TableCell colSpan={2} className="text-right">
                              <Badge variant="outline">{t("notContracted")}</Badge>
                            </TableCell>
                            <TableCell />
                            <TableCell className="pr-[18px]" />
                          </>
                        ) : (
                          <>
                            <TableCell className="num text-right">{f.amount(line.contractedCents)}</TableCell>
                            <TableCell className="min-w-[200px] whitespace-normal">
                              <LineOrders line={line} orderHref={orderHref} />
                            </TableCell>
                            {line.contracting === "open" ? (
                              <TableCell colSpan={2} className="pr-[18px] text-right text-meta text-muted-foreground">
                                {t("noDeviationYet")}
                              </TableCell>
                            ) : (
                              <>
                                <TableCell className={cn("num text-right", deviationTone(line.deviationCents))}>
                                  {line.deviationCents !== null && f.signedAmount(line.deviationCents)}
                                </TableCell>
                                <TableCell className={cn("num pr-[18px] text-right", deviationTone(line.deviationCents))}>
                                  {line.deviationBp !== null && f.signedPercent(line.deviationBp)}
                                </TableCell>
                              </>
                            )}
                          </>
                        )}
                      </TableRow>
                    ))}
                </tbody>
              </Fragment>
            );
          })}
          {total && (
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={2} className="pl-[18px]">
                  {t("total", { count: total.lines })}
                </TableCell>
                <RollupCells rollup={total} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      )}
    </section>
  );
}
