"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { orderLabel, type ConstructionCosts, type CostLine } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { deviationTone, useControlFormat } from "./format";
import { Dot } from "./pills";

/** The orders that contract a line, each linked; a late delivery flagged. */
function LineOrders({ line, orderHref }: { line: CostLine; orderHref: (orderId: string) => string }) {
  const t = useTranslations("construction.costs");
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12.5px]">
      {line.orders.map((order) => (
        <li key={order.id} className="flex flex-wrap items-center gap-x-1.5">
          <Link href={orderHref(order.id)} className="num font-medium text-brand-ink hover:text-primary">
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

/**
 * Presentational: cost per budget line, chapter by chapter (each folds
 * open): what we expected to pay against what Compras contracted, and the
 * orders behind it. A line not contracted yet shows only its cost, never a
 * zero; an open line (more still to order) shows what is contracted so far,
 * never a deviation.
 */
export default function CostTable({
  chapters,
  expanded,
  onToggle,
  orderHref,
  newOrderHref,
}: {
  /** The chapters and lines to show (already filtered). */
  chapters: ConstructionCosts["chapters"];
  expanded: (code: string) => boolean;
  onToggle: (code: string) => void;
  orderHref: (orderId: string) => string;
  /** "Pedir" on a chapter nothing is contracted for. */
  newOrderHref?: (chapterCode: string) => string;
}) {
  const t = useTranslations("construction.costs");
  const f = useControlFormat();

  return (
    <section className={cn(cardVariants({ size: "flush" }), "py-1.5")} aria-label={t("tableLabel")}>
      {chapters.length === 0 ? (
        <p className="px-[18px] py-6 text-center text-[13.5px] text-muted-foreground">{t("noMatch")}</p>
      ) : (
        <Table className="min-w-[1000px] text-[13px]">
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
          <TableBody>
            {chapters.map((chapter) => {
              const open = expanded(chapter.code);
              const closed = chapter.lines.filter((l) => l.contracting === "closed").length;
              const opened = chapter.lines.filter((l) => l.contracting === "open").length;
              const total = chapter.lines.length || 1;
              return (
                <Fragment key={chapter.code}>
                  <TableRow className="bg-raise/60">
                    <TableCell colSpan={7} className="p-0">
                      <div className="flex flex-wrap items-center gap-x-3 pr-[18px]">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => onToggle(chapter.code)}
                          className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-2 pl-[18px] text-left"
                        >
                          <ChevronRight aria-hidden className={cn("size-4 flex-none text-muted-foreground transition-transform", open && "rotate-90")} />
                          <span className="num font-semibold">{chapter.code}</span>
                          <b className="min-w-0 flex-1 whitespace-normal">{chapter.name}</b>
                          <span className="flex items-center gap-2 text-[12px] font-normal text-muted-foreground">
                            <span aria-hidden className="relative flex h-1.5 w-16 overflow-hidden rounded-full bg-border">
                              <span className="bg-primary" style={{ width: `${(closed / total) * 100}%` }} />
                              <span className="bg-primary/40" style={{ width: `${(opened / total) * 100}%` }} />
                            </span>
                            {t("closedOf", { closed, total: chapter.lines.length })}
                            {opened > 0 && ` · ${t("openCount", { count: opened })}`}
                          </span>
                        </button>
                        {newOrderHref && closed + opened === 0 && (
                          <Link href={newOrderHref(chapter.code)} className="text-[12px] font-semibold text-brand-ink hover:text-primary pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
                            {t("order")}
                          </Link>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
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
                              <TableCell colSpan={2} className="pr-[18px] text-right text-[12px] text-muted-foreground">
                                {t("noDeviationYet")}
                              </TableCell>
                            ) : (
                              <>
                                <TableCell className={cn("num text-right", deviationTone(line.deviationCents))}>
                                  {line.deviationCents !== null && f.signedDecimal(line.deviationCents)}
                                </TableCell>
                                <TableCell className={cn("num pr-[18px] text-right", deviationTone(line.deviationCents))}>
                                  {line.deviationBp !== null && f.signedPct(line.deviationBp)}
                                </TableCell>
                              </>
                            )}
                          </>
                        )}
                      </TableRow>
                    ))}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
