"use client";

// Presentational: the Compras by budget line, folded by chapter. The container
// (PurchaseLinesScreen) filters.

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import {
  PURCHASE_PROGRESS,
  type ProjectPurchaseLines,
} from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { deviationTone } from "../construction/format";
import FoldRow from "../construction/FoldRow";
import { Dot } from "../construction/pills";
import { usePurchaseFormat } from "./format";
import type { LineRollup } from "./line-rollup";
import { InvoiceStatePill, PROGRESS_TONE, ProgressPill } from "./pills";
import { LineDetail } from "./LineOrders";

export type LineChapter = ProjectPurchaseLines["chapters"][number] & {
  rollup: LineRollup;
  /** Its lines to contract must be ordered soon (or are late). */
  soon: { orderBy: string; lateDays: number } | null;
};

/** A chapter's money folded (or the obra's): cost, contracted, deviation, invoiced and paid. */
function RollupCells({ rollup }: { rollup: LineRollup }) {
  const f = usePurchaseFormat();
  const amount = (cents: number) => (cents ? f.amount(cents) : "—");
  return (
    <>
      <TableCell className="num text-right font-semibold">
        {f.amount(rollup.costCents)}
      </TableCell>
      <TableCell className="num text-right font-semibold">
        {amount(rollup.contractedCents)}
      </TableCell>
      <TableCell
        className={cn(
          "num text-right font-semibold",
          deviationTone(rollup.deviationCents),
        )}
      >
        {rollup.deviationCents === null
          ? "—"
          : f.signedAmount(rollup.deviationCents)}
      </TableCell>
      <TableCell className="num text-right font-semibold">
        {amount(rollup.invoicedCents)}
      </TableCell>
      <TableCell className="num text-right font-semibold">
        {amount(rollup.paidCents)}
      </TableCell>
    </>
  );
}

/** A chapter folded into one row: its lines' totals, how many are in each state, and what needs a look. */
function ChapterRow({
  chapter,
  open,
  controls,
  onToggle,
}: {
  chapter: LineChapter;
  open: boolean;
  /** The id of the rows it folds. */
  controls: string;
  onToggle: () => void;
}) {
  const t = useTranslations("purchasing.lines");
  const f = usePurchaseFormat();
  const { rollup, soon } = chapter;
  return (
    <FoldRow
      code={chapter.code}
      open={open}
      controls={controls}
      onToggle={onToggle}
      label={
        <>
          <b className="min-w-0">{chapter.name}</b>
          <span className="text-meta text-muted-foreground">
            {t("lineCount", { count: rollup.lines })}
          </span>
          {rollup.overdue > 0 && (
            <Badge variant="destructive" className="px-2 py-px">
              <Dot />
              {t("overdueLines", { count: rollup.overdue })}
            </Badge>
          )}
          {rollup.lateOrders > 0 && (
            <Badge variant="warn" className="px-2 py-px">
              <Dot />
              {t("lateOrders", { count: rollup.lateOrders })}
            </Badge>
          )}
          {soon && (
            <Badge variant="warn" className="px-2 py-px">
              <Dot />
              {soon.lateDays > 0
                ? t("orderLate", { days: soon.lateDays })
                : t("orderSoon", { date: f.date(soon.orderBy) })}
            </Badge>
          )}
        </>
      }
    >
      <RollupCells rollup={rollup} />
      <TableCell className="pr-[18px] whitespace-normal">
        <span className="flex flex-wrap items-center gap-1">
          {PURCHASE_PROGRESS.filter((key) => rollup.counts[key] > 0).map(
            (key) => (
              <Badge
                key={key}
                variant={PROGRESS_TONE[key]}
                className="px-2 py-px"
              >
                <Dot />
                {t(`stateCount.${key}`, { count: rollup.counts[key] })}
              </Badge>
            ),
          )}
        </span>
      </TableCell>
    </FoldRow>
  );
}

/**
 * The budget's lines chapter by chapter. Each chapter is one row with its
 * lines' cost, what is contracted, its deviation (over its closed lines),
 * invoiced and paid, how many lines are in each state and what needs a look
 * (invoices past due, late deliveries, lines to order soon); it folds open
 * on its lines, and a line on its orders, milestones, invoices and payments.
 */
export function LineTable({
  projectId,
  chapters,
  total,
  open,
  onToggleChapter,
  expanded,
  onToggle,
  newOrderHref,
}: {
  projectId: string;
  /** Already filtered, each with its lines' totals. */
  chapters: LineChapter[];
  /** The obra's totals, shown only while nothing is filtered out. */
  total?: LineRollup;
  open: (chapterCode: string) => boolean;
  onToggleChapter: (chapterCode: string) => void;
  expanded: (lineageId: string) => boolean;
  onToggle: (lineageId: string) => void;
  /** "Crear pedido" on a line nobody ordered; omitted for viewers. */
  newOrderHref?: (chapterCode: string) => string;
}) {
  const t = useTranslations("purchasing.lines");
  const f = usePurchaseFormat();
  const count = chapters.reduce((sum, c) => sum + c.lines.length, 0);
  if (count === 0)
    return (
      <p className="px-[18px] py-6 text-center text-sm text-muted-foreground">
        {t("noMatch")}
      </p>
    );
  return (
    <Table className="min-w-[940px]">
      <TableHeader>
        <TableRow>
          <TableHead className="pl-[18px]">{t("line")}</TableHead>
          <TableHead className="text-right">{t("cost")}</TableHead>
          <TableHead className="text-right">{t("contracted")}</TableHead>
          <TableHead className="text-right">{t("deviation")}</TableHead>
          <TableHead className="text-right">{t("invoiced")}</TableHead>
          <TableHead className="text-right">{t("paid")}</TableHead>
          <TableHead className="pr-[18px]">{t("state")}</TableHead>
        </TableRow>
      </TableHeader>
      {chapters.map((chapter) => {
        const body = `lines-chapter-${chapter.code}`;
        const folded = !open(chapter.code);
        return (
          <Fragment key={chapter.code}>
            <tbody>
              <ChapterRow
                chapter={chapter}
                open={!folded}
                controls={body}
                onToggle={() => onToggleChapter(chapter.code)}
              />
            </tbody>
            <tbody id={body}>
              {!folded &&
                chapter.lines.map((line) => {
                  const lineOpen = expanded(line.lineageId);
                  return (
                    <Fragment key={line.lineageId}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => onToggle(line.lineageId)}
                      >
                        <TableCell className="p-0 whitespace-normal">
                          <button
                            type="button"
                            aria-expanded={lineOpen}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggle(line.lineageId);
                            }}
                            className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 py-2 pl-[18px] text-left"
                          >
                            <ChevronRight
                              aria-hidden
                              className={cn(
                                "size-4 flex-none text-muted-foreground transition-transform",
                                lineOpen && "rotate-90",
                              )}
                            />
                            <span className="num flex-none text-muted-foreground">
                              {line.code}
                            </span>
                            <span className="min-w-0">{line.description}</span>
                          </button>
                        </TableCell>
                        <TableCell className="num text-right">
                          {f.amount(line.costCents)}
                        </TableCell>
                        <TableCell className="num text-right">
                          {line.contracting === "none"
                            ? "—"
                            : f.amount(line.contractedCents)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "num text-right",
                            line.deviationCents === null
                              ? "text-muted-foreground"
                              : deviationTone(line.deviationCents),
                          )}
                        >
                          {line.deviationCents !== null ? (
                            f.signedAmount(line.deviationCents)
                          ) : line.uncontractedCents > 0 ? (
                            <span className="font-sans text-meta">
                              {t("toContract", {
                                amount: f.amount(line.uncontractedCents),
                              })}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="num text-right">
                          {line.invoicedCents
                            ? f.amount(line.invoicedCents)
                            : "—"}
                        </TableCell>
                        <TableCell className="num text-right">
                          {line.paidCents ? f.amount(line.paidCents) : "—"}
                        </TableCell>
                        <TableCell className="pr-[18px]">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <ProgressPill progress={line.progress} />
                            {line.overdue && (
                              <InvoiceStatePill state="overdue" />
                            )}
                          </span>
                        </TableCell>
                      </TableRow>
                      {lineOpen && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell
                            colSpan={7}
                            className="bg-raise/40 py-3 pr-[18px] pl-[44px] whitespace-normal"
                          >
                            <LineDetail
                              projectId={projectId}
                              line={line}
                              orderBy={chapter.orderBy}
                              newOrderHref={newOrderHref?.(chapter.code)}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </Fragment>
        );
      })}
      {total && (
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell className="pl-[18px]">
              {t("total", { count: total.lines })}
            </TableCell>
            <RollupCells rollup={total} />
            <TableCell className="pr-[18px] text-meta font-normal text-muted-foreground">
              {t("closedNote", { count: total.closedLines })}
            </TableCell>
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}
