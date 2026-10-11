"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ProjectObra } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { useObraFormat } from "./format";
import { cardHead, codeChip, columns, muted, table } from "./classes";
import ProgressBar from "./ProgressBar";
import StatusPill from "./StatusPill";

const COLUMNS = "48px minmax(160px, 1fr) 120px 72px 200px 56px 110px";

/** Presentational: the budget's chapters with their progress — what the client sees. */
export default function ChapterTable({
  obra,
  chapterHref,
}: {
  obra: ProjectObra;
  chapterHref: (code: string) => string;
}) {
  const t = useTranslations("obra.page");
  const f = useObraFormat();

  return (
    <section className={cardVariants()}>
      <div className={cardHead}>
        <h2>{t("chapters")}</h2>
        <span className={muted}>{t("chaptersSummary", { count: obra.chapters.length })}</span>
      </div>
      <div role="table" aria-label={t("chapters")} className={table.root} style={columns(COLUMNS)}>
        <div role="row" className={table.head}>
          <span role="columnheader">{t("code")}</span>
          <span role="columnheader">{t("name")}</span>
          <span role="columnheader" className={table.right}>{t("amount")}</span>
          <span role="columnheader" className={table.right}>{t("share")}</span>
          <span role="columnheader">{t("progress")}</span>
          <span role="columnheader">{t("hito")}</span>
          <span role="columnheader">{t("state")}</span>
        </div>
        {obra.chapters.map((chapter) => (
          <div role="row" key={chapter.code} className={table.row}>
            <span role="cell" className={codeChip}>{chapter.code}</span>
            <span role="cell" className={table.name}>
              <Link href={chapterHref(chapter.code)} className={table.nameLink}>
                {chapter.name}
              </Link>
            </span>
            <span role="cell" className={`num ${table.right}`}>{f.money(chapter.totalCents)}</span>
            <span role="cell" className={`num text-muted-foreground ${table.right}`}>{f.share(chapter.shareBp)}</span>
            <span role="cell" className={table.progress}>
              <ProgressBar pct={chapter.progressPct} />
              <span className="num">{chapter.progressPct} %</span>
            </span>
            <span role="cell" className="text-muted-foreground">{chapter.hitoCode ?? "—"}</span>
            <span role="cell"><StatusPill status={chapter.status} /></span>
          </div>
        ))}
        {obra.budget && (
          <div role="row" className={table.total}>
            <span role="cell" />
            <span role="cell">{t("total", { number: obra.budget.number })}</span>
            <span role="cell" className={`num ${table.right}`}>{f.money(obra.budget.totalCents)}</span>
            <span role="cell" className={table.right}>100 %</span>
            <span role="cell">{t("totalProgress", { pct: obra.progressPct })}</span>
            <span role="cell" />
            <span role="cell" />
          </div>
        )}
      </div>
    </section>
  );
}
