"use client";

// Container for Obra › Planificación: the only part of it that knows about
// server actions (opening a draft). The views in ../../components/planning
// take props only.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ProjectPlanning } from "@repo/core/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createPlanningDraftAction } from "../../../../../actions/planning";
import FormError from "../../../../components/FormError";
import ObraFrame, { chapterHref, type ObraHeader } from "../../components/construction/ObraFrame";
import { timelineSpanning } from "../../components/construction/Gantt";
import { chip, muted } from "../../components/obra/classes";
import { useObraAction } from "../../components/obra/useObraAction";
import GeneratePlanForm from "../../components/planning/GeneratePlanForm";
import { planningHref } from "../../components/planning/links";
import {
  BaselineBanner,
  DraftNotice,
  PlanCards,
  PlanKpis,
  PlanLegend,
  PlanTable,
  useCalendarText,
} from "../../components/planning/PlanViews";

/** The approved plan and where the works are heading, or the way to a first one. */
export default function PlanningScreen({
  projectId,
  header,
  planning,
  canManage,
}: {
  projectId: string;
  header: ObraHeader;
  planning: ProjectPlanning;
  canManage: boolean;
}) {
  const t = useTranslations("planning");
  const router = useRouter();
  const action = useObraAction();
  const calendarText = useCalendarText();
  const [showBaseline, setShowBaseline] = useState(true);
  const [onlyCritical, setOnlyCritical] = useState(false);
  const { baseline, draft, today } = planning;
  const editHref = planningHref(projectId, "editar");
  const openDraft = (input: Record<string, unknown>) =>
    action.run(() => createPlanningDraftAction(projectId, input), () => router.push(editHref));

  const aside = baseline && (
    <div className="flex flex-wrap gap-2">
      <Link href={planningHref(projectId, "versiones")} className={buttonVariants({ variant: "outline" })}>
        {t("versionsLink")}
      </Link>
      {canManage &&
        (draft ? (
          <Link href={editHref} className={buttonVariants()}>
            {t("continueDraft", { number: draft.number })}
          </Link>
        ) : (
          <Button type="button" disabled={action.pending} onClick={() => openDraft({ from: "baseline" })}>
            {t("editPlan")}
          </Button>
        ))}
    </div>
  );

  let body: React.ReactNode;
  if (baseline) {
    const rows = onlyCritical ? baseline.rows.filter((r) => r.critical) : baseline.rows;
    const timeline = timelineSpanning(
      [planning.startDate, planning.completionDate, ...baseline.rows.flatMap((r) => [r.plannedStart, r.plannedEnd, r.forecastStart, r.forecastEnd])],
      today,
    )!;
    body = (
      <>
        <BaselineBanner baseline={baseline} />
        {draft && <DraftNotice draft={draft} href={editHref} canManage={canManage} />}
        <PlanKpis baseline={baseline} completionDate={planning.completionDate} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip} aria-pressed={showBaseline} onClick={() => setShowBaseline((on) => !on)}>
              {t("table.compare")}
            </button>
            <button type="button" className={chip} aria-pressed={onlyCritical} onClick={() => setOnlyCritical((on) => !on)}>
              {t("table.onlyCritical")}
            </button>
          </div>
          <PlanLegend today={today} showBaseline={showBaseline} />
        </div>
        <PlanTable rows={rows} timeline={timeline} today={today} showBaseline={showBaseline} chapterHref={(code) => chapterHref(projectId, code)} />
        <PlanCards rows={rows} timeline={timeline} today={today} showBaseline={showBaseline} chapterHref={(code) => chapterHref(projectId, code)} />
        <p className={cn(muted, "max-w-[90ch] leading-normal")}>{t("footnote", { calendar: calendarText(baseline.calendar) })}</p>
      </>
    );
  } else if (draft) {
    body = <DraftNotice draft={draft} href={editHref} canManage={canManage} />;
  } else if (planning.chapters.length === 0) {
    body = <p className={cn(cardVariants(), "text-center text-[13.5px] text-muted-foreground")}>{t("generate.noBudget")}</p>;
  } else {
    body = (
      <>
        <p className={cn(cardVariants(), "border-dashed text-[13.5px] leading-normal text-muted-foreground")}>
          <b className="text-foreground">{t("generate.empty")}</b> {t("generate.emptyHint", { count: planning.chapters.length })}
        </p>
        {canManage ? (
          <GeneratePlanForm
            chapters={planning.chapters}
            copyFrom={planning.copyFrom}
            startDate={planning.startDate}
            completionDate={planning.completionDate}
            today={today}
            pending={action.pending}
            error={<FormError namespace="planning.errors" error={action.state?.error} />}
            onSubmit={(input) => openDraft(input)}
          />
        ) : (
          <p className={muted}>{t("generate.viewerHint")}</p>
        )}
      </>
    );
  }

  return (
    <ObraFrame projectId={projectId} header={header} current="planning" title={t("title")} description={t("description")} aside={aside}>
      {baseline && <FormError namespace="planning.errors" error={action.state?.error} />}
      {body}
    </ObraFrame>
  );
}
