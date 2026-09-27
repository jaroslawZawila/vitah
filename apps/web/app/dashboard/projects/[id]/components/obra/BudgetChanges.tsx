"use client";

import { useTranslations } from "next-intl";
import type { BudgetRevision } from "@repo/core/contract";
import { useObraFormat } from "./format";
import styles from "./obra.module.css";
import { columns } from "./table";

const COLUMNS = "48px minmax(0, 1.2fr) 120px 120px 120px minmax(0, 1.5fr)";

/** Presentational: how the revision's chapters differ from the previous revision's. */
export default function BudgetChanges({ revision }: { revision: BudgetRevision }) {
  const t = useTranslations("obra.budget");
  const f = useObraFormat();
  const previous = revision.previous;
  if (!previous) return null;
  const rows = [
    ...revision.chapters
      .filter((c) => c.change !== null)
      .map((c) => ({ code: c.code, name: c.name, before: c.previousTotalCents, after: c.totalCents, why: c.changeNote })),
    ...revision.removedChapters.map((c) => ({ code: c.code, name: c.name, before: c.totalCents, after: null, why: t("removed") })),
  ];
  const title = t("changes", { number: previous.number });

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className={styles.muted}>{t("noChanges")}</p>
      ) : (
        <div role="table" aria-label={title} className={styles.table} style={columns(COLUMNS)}>
          <div role="row" className={styles.headRow}>
            <span role="columnheader">{t("codeCol")}</span>
            <span role="columnheader">{t("descriptionCol")}</span>
            <span role="columnheader" className={styles.right}>{t("before", { number: previous.number })}</span>
            <span role="columnheader" className={styles.right}>{t("after", { number: revision.number })}</span>
            <span role="columnheader" className={styles.right}>{t("delta")}</span>
            <span role="columnheader">{t("changesWhy")}</span>
          </div>
          {rows.map((row) => (
            <div role="row" key={row.code} className={styles.row}>
              <span role="cell" className={styles.code}>{row.code}</span>
              <span role="cell" className={styles.rowName}>{row.name}</span>
              <span role="cell" className={`${styles.num} ${styles.right} ${styles.muted}`}>{row.before === null ? "—" : f.money(row.before)}</span>
              <span role="cell" className={`${styles.num} ${styles.right}`}>{row.after === null ? "—" : f.money(row.after)}</span>
              <span role="cell" className={`${styles.num} ${styles.right} ${styles.strong}`}>
                {f.signedMoney((row.after ?? 0) - (row.before ?? 0))}
              </span>
              <span role="cell" className={styles.muted}>{row.why ?? ""}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
