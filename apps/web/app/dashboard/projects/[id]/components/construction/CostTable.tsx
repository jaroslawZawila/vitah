"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { ConstructionCosts } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { deviationTone, useControlFormat } from "./format";

/**
 * Presentational: cost per budget line, chapter by chapter (each folds
 * open): what we expected to pay against what was contracted. A line not
 * contracted yet shows only its cost, never a zero.
 */
export default function CostTable({
  chapters,
  expanded,
  onToggle,
}: {
  /** The chapters and lines to show (already filtered). */
  chapters: ConstructionCosts["chapters"];
  expanded: (code: string) => boolean;
  onToggle: (code: string) => void;
}) {
  const t = useTranslations("construction.costs");
  const f = useControlFormat();

  return (
    <section className={cn(cardVariants({ size: "flush" }), "py-1.5")} aria-label={t("tableLabel")}>
      {chapters.length === 0 ? (
        <p className="px-[18px] py-6 text-center text-[13.5px] text-muted-foreground">{t("noMatch")}</p>
      ) : (
        <Table className="min-w-[900px] text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-[18px]">{t("line")}</TableHead>
              <TableHead>{t("descriptionCol")}</TableHead>
              <TableHead>{t("unit")}</TableHead>
              <TableHead className="text-right">{t("quantity")}</TableHead>
              <TableHead className="text-right">{t("cost")}</TableHead>
              <TableHead className="text-right">{t("contracted")}</TableHead>
              <TableHead className="text-right">{t("deviation")}</TableHead>
              <TableHead className="pr-[18px] text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {chapters.map((chapter) => {
              const open = expanded(chapter.code);
              const contracted = chapter.lines.filter((l) => l.contractedCents !== null).length;
              const pct = chapter.lines.length ? (contracted / chapter.lines.length) * 100 : 0;
              return (
                <Fragment key={chapter.code}>
                  <TableRow className="bg-raise/60">
                    <TableCell colSpan={8} className="p-0">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => onToggle(chapter.code)}
                        className="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-[18px] py-2 text-left"
                      >
                        <ChevronRight aria-hidden className={cn("size-4 flex-none text-muted-foreground transition-transform", open && "rotate-90")} />
                        <span className="num font-semibold">{chapter.code}</span>
                        <b className="min-w-0 flex-1 whitespace-normal">{chapter.name}</b>
                        <span className="flex items-center gap-2 text-[12px] font-normal text-muted-foreground">
                          <span aria-hidden className="relative block h-1.5 w-16 overflow-hidden rounded-full bg-border">
                            <span className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${pct}%` }} />
                          </span>
                          {t("contractedOf", { contracted, total: chapter.lines.length })}
                        </span>
                      </button>
                    </TableCell>
                  </TableRow>
                  {open &&
                    chapter.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="num pl-[18px] text-muted-foreground">{line.code}</TableCell>
                        <TableCell className="min-w-[260px] whitespace-normal">{line.description}</TableCell>
                        <TableCell className="text-muted-foreground">{line.unit}</TableCell>
                        <TableCell className="num text-right">{f.decimal(line.quantity)}</TableCell>
                        <TableCell className="num text-right">{f.decimal(line.costCents / 100)}</TableCell>
                        {line.contractedCents === null ? (
                          <>
                            <TableCell className="text-right">
                              <Badge variant="outline">{t("notContracted")}</Badge>
                            </TableCell>
                            <TableCell />
                            <TableCell className="pr-[18px]" />
                          </>
                        ) : (
                          <>
                            <TableCell className="num text-right">{f.decimal(line.contractedCents / 100)}</TableCell>
                            <TableCell className={cn("num text-right", deviationTone(line.deviationCents))}>
                              {line.deviationCents !== null &&
                                `${line.deviationCents > 0 ? "+" : line.deviationCents < 0 ? "−" : ""}${f.decimal(Math.abs(line.deviationCents) / 100)}`}
                            </TableCell>
                            <TableCell className={cn("num pr-[18px] text-right", deviationTone(line.deviationCents))}>
                              {line.deviationBp !== null && f.signedPct(line.deviationBp)}
                            </TableCell>
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
