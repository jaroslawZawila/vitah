"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Hito } from "@repo/core/contract";
import { useObraFormat } from "./format";
import styles from "./obra.module.css";
import { columns } from "./table";
import StatusPill from "./StatusPill";

const COLUMNS = "44px minmax(0, 1fr) 48px 120px minmax(0, 0.8fr) minmax(0, 1fr) 140px";

/** Presentational: the payment plan H0–H9, each hito with its chapters and state. */
export default function HitoTable({
  hitos,
  totalCents,
  hitoHref,
}: {
  hitos: Hito[];
  totalCents: number;
  hitoHref: (hito: Hito) => string;
}) {
  const t = useTranslations("obra.payments");
  const f = useObraFormat();
  const when = (hito: Hito) => {
    if (hito.paidOn) return t("paidOn", { date: f.date(hito.paidOn) });
    if (hito.dueOn) return t("due", { date: f.date(hito.dueOn) });
    if (hito.readyPct > 0) return t("ready", { pct: hito.readyPct });
    return null;
  };

  return (
    <div role="table" aria-label={t("title")} className={styles.table} style={columns(COLUMNS)}>
      <div role="row" className={styles.headRow}>
        <span role="columnheader">{t("hito")}</span>
        <span role="columnheader">{t("name")}</span>
        <span role="columnheader" className={styles.right}>{t("pct")}</span>
        <span role="columnheader" className={styles.right}>{t("amount")}</span>
        <span role="columnheader">{t("moment")}</span>
        <span role="columnheader">{t("chapters")}</span>
        <span role="columnheader">{t("state")}</span>
      </div>
      {hitos.map((hito) => {
        const done = hito.checks.filter((c) => c.done).length;
        return (
          <div role="row" key={hito.id} className={styles.row}>
            <span role="cell" className={styles.code}>{hito.code}</span>
            <span role="cell" className={styles.rowName}>
              <Link href={hitoHref(hito)} className={styles.rowLink}>
                {hito.name}
              </Link>
            </span>
            <span role="cell" className={`${styles.num} ${styles.right} ${styles.muted}`}>{f.share(hito.pctBp)}</span>
            <span role="cell" className={`${styles.num} ${styles.right}`}>{f.money(hito.amountCents)}</span>
            <span role="cell" className={styles.muted}>{hito.billingMoment}</span>
            <span role="cell" className={styles.chips}>
              {hito.chapters.map((chapter) => (
                <span key={chapter.code} className={styles.chip}>
                  <span className={styles.chipCode}>{chapter.code}</span>
                  <span className={styles.muted}>{chapter.progressPct} %</span>
                </span>
              ))}
              {hito.checks.length > 0 && (
                <span className={styles.chip}>{t("checks", { done, total: hito.checks.length })}</span>
              )}
            </span>
            <span role="cell" className={styles.stateCell}>
              <StatusPill status={hito.status} kind="hitoStatus" />
              {when(hito) && <span className={styles.muted}>{when(hito)}</span>}
            </span>
          </div>
        );
      })}
      <div role="row" className={styles.totalRow}>
        <span role="cell" />
        <span role="cell">{t("total")}</span>
        <span role="cell" className={styles.right}>{f.share(hitos.reduce((sum, h) => sum + h.pctBp, 0))}</span>
        <span role="cell" className={`${styles.num} ${styles.right}`}>{f.money(totalCents)}</span>
        <span role="cell" />
        <span role="cell" />
        <span role="cell" />
      </div>
    </div>
  );
}
