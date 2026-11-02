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
    // The works' actual start once Avance has one, else the planned one.
    const worksFrom = obra.stageEvidence[6] ?? obra.term?.startDate;
    if (stage === 6 && worksFrom) return t("stageMeta.from", { date: f.date(worksFrom) });
    const hito = obra.hitos.find((h) => h.code === STAGE_HITOS[stage]);
    if (hito?.paidOn) return t("stageMeta.paid", { code: hito.code, date: f.date(hito.paidOn) });
    return t(`stageHints.${stage}`);
  }

  // The stage moves up on its own with the evidence: say since when, and what moves it next
  // (not when that is already in, the stage having been set back by hand).
  const since = obra.stageEvidence[obra.stage];
  const next = OBRA_STAGES.find((stage) => stage === obra.stage + 1 && !obra.stageEvidence[stage]);
  const auto = [
    since && t("stageAuto.since", { date: f.date(since), evidence: t(`stageAuto.evidence.${obra.stage}`) }),
    next && t("stageAuto.next", { name: t(`stages.${next}`), evidence: t(`stageAuto.evidence.${next}`) }),
  ].filter(Boolean);

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
      {auto.length > 0 && <p className="text-[12.5px] text-muted-foreground">{auto.join(" · ")}</p>}
    </section>
  );
}
