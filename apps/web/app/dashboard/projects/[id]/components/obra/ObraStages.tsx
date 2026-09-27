"use client";

import { useTranslations } from "next-intl";
import { OBRA_STAGES, STAGE_HITOS, type ProjectObra } from "@repo/core/contract";
import { useObraFormat } from "./format";
import styles from "./obra.module.css";
import Stepper from "./Stepper";

/** Presentational: the 8 stages of the process, with what each rests on. */
export default function ObraStages({
  obra,
  onSetStage,
}: {
  obra: ProjectObra;
  /** Omitted for users who can't change the stage. */
  onSetStage?: (stage: number) => void;
}) {
  const t = useTranslations("obra");
  const f = useObraFormat();

  /** What a stage rests on: the accepted budget, the works' start, or its hito's payment. */
  function meta(stage: (typeof OBRA_STAGES)[number]) {
    if (stage === 3 && obra.budget) {
      return t("stageMeta.budget", { number: obra.budget.number, total: f.money(obra.budget.totalCents) });
    }
    if (stage === 6 && obra.term) return t("stageMeta.from", { date: f.date(obra.term.startDate) });
    const hito = obra.hitos.find((h) => h.code === STAGE_HITOS[stage]);
    if (hito?.paidOn) return t("stageMeta.paid", { code: hito.code, date: f.date(hito.paidOn) });
    return t(`stageHints.${stage}`);
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.label}>{t("page.process")}</span>
      </div>
      <Stepper
        label={t("page.process")}
        steps={OBRA_STAGES.map((stage) => {
          const name = t(`stages.${stage}`);
          return {
            key: String(stage),
            label: `${stage} · ${name}`,
            meta: meta(stage),
            state: stage < obra.stage ? "done" : stage === obra.stage ? "current" : "todo",
            onSelect: onSetStage && stage !== obra.stage ? () => onSetStage(stage) : undefined,
            selectLabel: t("page.setStage", { number: stage, name }),
          };
        })}
      />
    </section>
  );
}
