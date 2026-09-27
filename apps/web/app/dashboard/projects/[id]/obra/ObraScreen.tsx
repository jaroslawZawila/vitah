"use client";

// Container for the Obra tab: the only part that knows about server actions.
// The views in ../components/obra take props only.

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ProjectObra } from "@repo/core/contract";
import { setObraStageAction } from "../../../../actions/obra";
import EmptyState from "../components/EmptyState";
import FormError from "../components/FormError";
import { SleepingCamera } from "../components/illustrations";
import ChapterTable from "../components/obra/ChapterTable";
import ObraKpis from "../components/obra/ObraKpis";
import ObraStages from "../components/obra/ObraStages";
import obraStyles from "../components/obra/obra.module.css";
import { useObraAction } from "../components/obra/useObraAction";
import TabHeader from "../components/TabHeader";
import tabStyles from "../components/TabHeader.module.css";

/** The construction process of the project: stage, key figures and chapters. */
export default function ObraScreen({
  projectId,
  projectRef,
  obra,
  canManage,
}: {
  projectId: string;
  projectRef: string;
  obra: ProjectObra;
  canManage: boolean;
}) {
  const t = useTranslations("obra.page");
  const { state, run } = useObraAction();
  const base = `/dashboard/projects/${projectId}`;
  // Chapter codes are free text: encoded, the page decodes them.
  const chapterHref = (code: string) => `${base}/obra/${encodeURIComponent(code)}`;
  const firstActive = obra.chapters.find((c) => c.status === "active") ?? obra.chapters[0];

  const setStage = (stage: number) => run(() => setObraStageAction(projectId, stage));

  return (
    <div className={obraStyles.stack}>
      <TabHeader
        projectRef={projectRef}
        title={t("title")}
        summary={
          obra.budget
            ? t("summary", { reference: obra.budget.reference ?? t("noReference"), number: obra.budget.number })
            : t("noBudgetTitle")
        }
        action={
          canManage &&
          firstActive && (
            <Link href={chapterHref(firstActive.code)} className={tabStyles.action}>
              {t("updateProgress")}
            </Link>
          )
        }
      />
      <FormError namespace="obra.errors" error={state?.error} />
      <ObraStages obra={obra} onSetStage={canManage ? setStage : undefined} />
      {obra.budget ? (
        <>
          <ObraKpis obra={obra} paymentsHref={`${base}/payments`} />
          <ChapterTable obra={obra} chapterHref={chapterHref} />
        </>
      ) : (
        <div className={obraStyles.card}>
          <EmptyState illustration={<SleepingCamera />} title={t("noBudgetTitle")} text={t("noBudgetText")} />
          <p className={obraStyles.center}>
            <Link href={`${base}/budget`} className={obraStyles.link}>
              {t("goToBudget")}
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
