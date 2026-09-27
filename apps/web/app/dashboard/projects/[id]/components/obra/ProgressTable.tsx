"use client";

import { useTranslations } from "next-intl";
import type { BudgetLine } from "@repo/core/contract";
import { useObraFormat } from "./format";
import styles from "./obra.module.css";
import { columns } from "./table";
import ProgressBar from "./ProgressBar";

const COLUMNS = "56px minmax(0, 1fr) 40px 80px 110px 200px 110px";

/** Presentational: a chapter's lines (as edited) with an executed-% input each. */
export default function ProgressTable({
  code,
  lines,
  progress,
  onChange,
  disabled,
}: {
  code: string;
  lines: BudgetLine[];
  /** The chapter's progress with these lines. */
  progress: { totalCents: number; executedCents: number; progressPct: number };
  onChange: (lineId: string, pct: number) => void;
  disabled: boolean;
}) {
  const t = useTranslations("obra.chapter");
  const f = useObraFormat();

  return (
    <div role="table" aria-label={t("lines")} className={styles.table} style={columns(COLUMNS)}>
      <div role="row" className={styles.headRow}>
        <span role="columnheader">{t("codeCol")}</span>
        <span role="columnheader">{t("description")}</span>
        <span role="columnheader">{t("unit")}</span>
        <span role="columnheader" className={styles.right}>{t("qty")}</span>
        <span role="columnheader" className={styles.right}>{t("amount")}</span>
        <span role="columnheader">{t("executed")}</span>
        <span role="columnheader" className={styles.right}>{t("executedAmount")}</span>
      </div>
      {lines.map((line) => {
        const pct = line.executedPct;
        return (
          <div role="row" key={line.id} className={styles.row}>
            <span role="cell" className={`${styles.num} ${styles.muted}`}>{line.code}</span>
            <span role="cell" className={styles.rowName}>{line.description}</span>
            <span role="cell" className={styles.muted}>{line.unit}</span>
            <span role="cell" className={`${styles.num} ${styles.right}`}>{f.quantity(line.quantity)}</span>
            <span role="cell" className={`${styles.num} ${styles.right}`}>{f.money(line.amountCents)}</span>
            <span role="cell" className={styles.progressCell}>
              <span className={styles.pctInput}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  inputMode="numeric"
                  className={styles.input}
                  aria-label={t("executedLabel", { code: line.code })}
                  value={pct}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = Math.round(Number(event.target.value));
                    onChange(line.id, Number.isFinite(next) ? Math.min(100, Math.max(0, next)) : 0);
                  }}
                />
                <span className={styles.pctSign} aria-hidden>%</span>
              </span>
              <ProgressBar pct={pct} />
            </span>
            <span role="cell" className={`${styles.num} ${styles.right}`}>
              {f.money(Math.round((line.amountCents * pct) / 100))}
            </span>
          </div>
        );
      })}
      <div role="row" className={styles.totalRow}>
        <span role="cell" />
        <span role="cell">{t("subtotal", { code })}</span>
        <span role="cell" />
        <span role="cell" />
        <span role="cell" className={`${styles.num} ${styles.right}`}>{f.money(progress.totalCents)}</span>
        <span role="cell">{progress.progressPct} %</span>
        <span role="cell" className={`${styles.num} ${styles.right}`}>{f.money(progress.executedCents)}</span>
      </div>
    </div>
  );
}
