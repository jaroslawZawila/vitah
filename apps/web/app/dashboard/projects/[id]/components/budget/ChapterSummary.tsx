"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { BudgetRevision } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { cardHead, codeChip, columns, muted, table } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import InlinePct from "./InlinePct";

const COLUMNS = "52px minmax(200px, 1fr) 70px 110px 120px 70px 84px minmax(150px, auto)";

/**
 * Presentational: the twenty chapters as the client sees them (the PDF's
 * "Resumen por capítulos": each at its price, margins spread in) beside their
 * cost, each linking to its lines; then the cost, the margins and the PEC.
 * Chapter 20's share is editable on a draft (`onContingency`, in %).
 */
export default function ChapterSummary({
  revision,
  hrefOf,
  onContingency,
}: {
  revision: BudgetRevision;
  hrefOf: (code: string) => string;
  onContingency?: (pct: number) => void;
}) {
  const t = useTranslations("budget.chapters");
  const f = useObraFormat();
  const offAverage = new Set(revision.checks.filter((c) => c.kind === "ratio").map((c) => c.chapterCode));

  return (
    <section className={cardVariants()} aria-labelledby="chapters-title">
      <div className={cardHead}>
        <h2 id="chapters-title">{t("title")}</h2>
        <span className={muted}>{t("hint")}</span>
      </div>
      <div role="table" aria-labelledby="chapters-title" className={table.root} style={columns(COLUMNS)}>
        <div role="row" className={table.head}>
          <span role="columnheader">{t("code")}</span>
          <span role="columnheader">{t("name")}</span>
          <span role="columnheader" className={table.right}>{t("lines")}</span>
          <span role="columnheader" className={table.right}>{t("cost")}</span>
          <span role="columnheader" className={table.right}>{t("amount")}</span>
          <span role="columnheader" className={table.right}>{t("share")}</span>
          <span role="columnheader" className={table.right}>{t("perM2")}</span>
          <span role="columnheader">{t("flags")}</span>
        </div>
        {revision.chapters.map((chapter) => {
          const { computed: contingency, lineCount } = chapter;
          const estimated = chapter.lines.filter((l) => l.source === "estimated").length;
          return (
            <div role="row" key={chapter.id} className={table.row}>
              <span role="cell" className={codeChip}>{chapter.code}</span>
              <span role="cell" className={table.name}>
                {contingency ? (
                  <>
                    {chapter.name} <span className={muted}>{t("contingencyHint")}</span>
                  </>
                ) : (
                  <Link href={hrefOf(chapter.code)} className={table.nameLink}>{chapter.name}</Link>
                )}
              </span>
              <span role="cell" className={`num text-muted-foreground ${table.right}`}>
                {contingency && onContingency ? (
                  <InlinePct label={t("contingencyLabel")} bp={revision.contingencyBp} onCommit={onContingency} />
                ) : contingency ? (
                  f.share(revision.contingencyBp)
                ) : (
                  lineCount
                )}
              </span>
              <span role="cell" className={`num text-muted-foreground ${table.right}`}>{f.money(chapter.totalCents)}</span>
              <span role="cell" className={`num font-semibold ${table.right}`}>{f.money(chapter.priceCents)}</span>
              <span role="cell" className={`num text-muted-foreground ${table.right}`}>{f.share(chapter.shareBp)}</span>
              <span role="cell" className={`num text-muted-foreground ${table.right}`}>{chapter.perM2Cents === null ? "—" : f.money(chapter.perM2Cents)}</span>
              <span role="cell" className="flex flex-wrap gap-1.5">
                {estimated > 0 && <Badge variant="yel">{t("estimated", { count: estimated })}</Badge>}
                {offAverage.has(chapter.code) && <Badge variant="warn">{t("offAverage")}</Badge>}
                {chapter.change === "up" && <Badge variant="default">{t("up")}</Badge>}
                {chapter.change === "down" && <Badge variant="default">{t("down")}</Badge>}
              </span>
            </div>
          );
        })}
      </div>
      <dl className="grid gap-1.5 px-4 text-sm">
        {(
          [
            [t("costTotal"), revision.costCents],
            [t("overhead", { pct: f.share(revision.overheadBp) }), revision.overheadCents],
            [t("profit", { pct: f.share(revision.profitBp) }), revision.profitCents],
          ] as const
        ).map(([label, cents]) => (
          <div key={label} className="flex flex-wrap justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="num">{f.money(cents)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap justify-between gap-2 rounded-lg bg-rail px-4 py-3.5 font-semibold text-rail-foreground">
        <span>{t("total", { number: revision.number })}</span>
        <span className="num text-rail-accent">{f.money(revision.totalCents)}</span>
      </div>
      <p className={muted}>
        {t("vatNote", { rate: f.share(revision.vatRateBp), vat: f.money(revision.vatCents), total: f.money(revision.totalCents + revision.vatCents) })}
      </p>
    </section>
  );
}
