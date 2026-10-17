"use client";

import { useTranslations } from "next-intl";
import { OBRA_STAGES, STAGE_HITOS, type ProjectObra } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { useObraFormat } from "./format";
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
    <section className={cardVariants()}>
      <span className="eyebrow">{t("process")}</span>
      <Stepper
        label={t("process")}
        steps={OBRA_STAGES.map((stage) => {
          const name = t(`stages.${stage}`);
          return {
            key: String(stage),
            label: `${stage} · ${name}`,
            meta: meta(stage),
            state: stage < obra.stage ? "done" : stage === obra.stage ? "current" : "todo",
            onSelect: onSetStage && stage !== obra.stage ? () => onSetStage(stage) : undefined,
            selectLabel: t("setStage", { number: stage, name }),
          };
        })}
      />
    </section>
  );
}
