"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ProjectObra } from "@repo/core/contract";
import { useObraFormat } from "./format";
import styles from "./obra.module.css";
import { columns } from "./table";
import ProgressBar from "./ProgressBar";
import StatusPill from "./StatusPill";

const COLUMNS = "48px minmax(0, 1fr) 120px 72px 200px 56px 110px";

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
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{t("chapters")}</h2>
        <span className={styles.muted}>{t("chaptersSummary", { count: obra.chapters.length })}</span>
      </div>
      <div role="table" aria-label={t("chapters")} className={styles.table} style={columns(COLUMNS)}>
        <div role="row" className={styles.headRow}>
          <span role="columnheader">{t("code")}</span>
          <span role="columnheader">{t("name")}</span>
          <span role="columnheader" className={styles.right}>{t("amount")}</span>
          <span role="columnheader" className={styles.right}>{t("share")}</span>
          <span role="columnheader">{t("progress")}</span>
          <span role="columnheader">{t("hito")}</span>
          <span role="columnheader">{t("state")}</span>
        </div>
        {obra.chapters.map((chapter) => (
          <div role="row" key={chapter.code} className={styles.row}>
            <span role="cell" className={styles.code}>{chapter.code}</span>
            <span role="cell" className={styles.rowName}>
              <Link href={chapterHref(chapter.code)} className={styles.rowLink}>
                {chapter.name}
              </Link>
            </span>
            <span role="cell" className={`${styles.num} ${styles.right}`}>{f.money(chapter.totalCents)}</span>
            <span role="cell" className={`${styles.num} ${styles.right} ${styles.muted}`}>{f.share(chapter.shareBp)}</span>
            <span role="cell" className={styles.progressCell}>
              <ProgressBar pct={chapter.progressPct} />
              <span className={styles.num}>{chapter.progressPct} %</span>
            </span>
            <span role="cell" className={styles.muted}>{chapter.hitoCode ?? "—"}</span>
            <span role="cell"><StatusPill status={chapter.status} /></span>
          </div>
        ))}
        {obra.budget && (
          <div role="row" className={styles.totalRow}>
            <span role="cell" />
            <span role="cell">{t("total", { number: obra.budget.number })}</span>
            <span role="cell" className={`${styles.num} ${styles.right}`}>{f.money(obra.budget.totalCents)}</span>
            <span role="cell" className={styles.right}>100 %</span>
            <span role="cell">{t("totalProgress", { pct: obra.progressPct })}</span>
            <span role="cell" />
            <span role="cell" />
          </div>
        )}
      </div>
    </section>
  );
}
