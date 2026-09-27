"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Hito } from "@repo/core/contract";
import { useObraFormat } from "./format";
import styles from "./obra.module.css";
import ProgressBar from "./ProgressBar";

/** Presentational: how ready a hito is for its acta — its chapters and checks. */
export default function HitoReadiness({ hito, href }: { hito: Hito; href: string }) {
  const t = useTranslations("obra.chapter");
  const f = useObraFormat();

  return (
    <section className={styles.cardSnug}>
      <div className={styles.cardHeadFlush}>
        <Link href={href} className={styles.link}>
          {t("hitoCard", { code: hito.code, name: hito.name })}
        </Link>
        <span className={styles.good}>{t("hitoReady", { pct: hito.readyPct })}</span>
      </div>
      <div className={styles.stack}>
        {hito.chapters.map((chapter) => (
          <div key={chapter.code} className={styles.miniGrid}>
            <span className={styles.code}>{chapter.code}</span>
            <ProgressBar pct={chapter.progressPct} />
            <span className={styles.num}>{chapter.progressPct} %</span>
          </div>
        ))}
      </div>
      {hito.checks.map((check) => (
        <div key={check.id} className={styles.checkRow}>
          <label className={styles.checkLabel}>
            <input type="checkbox" checked={check.done} readOnly disabled />
            {check.label}
          </label>
        </div>
      ))}
      <span className={styles.muted}>
        {t("billedWhen", { moment: hito.billingMoment, amount: f.money(hito.amountCents) })}
      </span>
    </section>
  );
}
