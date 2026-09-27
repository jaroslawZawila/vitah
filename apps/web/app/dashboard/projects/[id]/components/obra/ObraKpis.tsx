"use client";

import { useTranslations } from "next-intl";
import type { ProjectObra } from "@repo/core/contract";
import { useObraFormat } from "./format";
import Kpi from "./Kpi";
import styles from "./obra.module.css";

/** Presentational: built, collected, schedule and the next milestone. */
export default function ObraKpis({ obra, paymentsHref }: { obra: ProjectObra; paymentsHref: string }) {
  const t = useTranslations("obra.page");
  const tStatus = useTranslations("obra.hitoStatus");
  const f = useObraFormat();
  const total = obra.budget?.totalCents ?? 0;
  const invoiced = obra.hitos.find((h) => h.status === "invoiced");
  // The first hito not yet paid.
  const next = obra.hitos.find((h) => h.status !== "paid");
  const { term } = obra;

  return (
    <section className={styles.kpis}>
      <Kpi
        label={t("executed")}
        value={`${obra.progressPct} %`}
        pct={obra.progressPct}
        hints={[t("executedOf", { executed: f.money(obra.executedCents), total: f.money(total) })]}
      />
      <Kpi
        label={t("collected")}
        value={f.money(obra.paidCents)}
        hints={[
          t("collectedHint", { pct: f.ratio(obra.paidCents, total) }),
          invoiced?.dueOn && t("invoicedDue", { code: invoiced.code, date: f.date(invoiced.dueOn) }),
        ].filter(Boolean)}
      />
      {term ? (
        <Kpi
          label={t("term")}
          value={
            <>
              {t("week", { week: term.week })} <small>{t("ofWeeks", { total: term.totalWeeks })}</small>
            </>
          }
          hints={[
            t("termDates", { start: f.date(term.startDate), end: f.date(term.completionDate) }),
            term.lateDays > 0 ? (
              <span className={styles.bad}>
                {t("late", { days: term.lateDays })}
                {term.penaltyCents > 0 && ` · ${t("penalty", { amount: f.money(term.penaltyCents) })}`}
              </span>
            ) : (
              <span className={styles.good}>{t("onTime")}</span>
            ),
          ]}
        />
      ) : (
        <Kpi label={t("term")} value={<small>{t("noDates")}</small>} />
      )}
      <Kpi
        label={t("nextHito")}
        href={paymentsHref}
        value={next ? `${next.code} · ${next.name}` : <small>{t("allPaid")}</small>}
        pct={next?.readyPct}
        hints={
          next
            ? [
                next.status === "signed" || next.status === "invoiced"
                  ? `${tStatus(next.status)} · ${f.money(next.amountCents)}`
                  : t("ready", { pct: next.readyPct, amount: f.money(next.amountCents) }),
              ]
            : []
        }
      />
    </section>
  );
}
