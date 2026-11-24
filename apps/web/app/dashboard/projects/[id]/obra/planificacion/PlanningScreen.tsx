"use client";

// Container for Obra › Planificación: the only part of it that knows about
// server actions (opening a draft; starting, finishing and correcting a
// chapter through ChapterProgress; an issue or a photo through IssueEditor and
// UploadPhotos). The views in ../../components/planning and
// ../../components/construction take props only.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ConstructionControl, ControlChapter, PlanningDraftNewInput, ProjectPlanning } from "@repo/core/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createPlanningDraftAction } from "../../../../../actions/planning";
import FormError from "../../../../components/FormError";
import Modal from "../../components/Modal";
import { StateFilterBar, type StateFilter } from "../../components/construction/Filters";
import { GanttLegend, timelineOf } from "../../components/construction/Gantt";
import ObraFrame, { chapterHref, type ObraHeader } from "../../components/construction/ObraFrame";
import { Source } from "../../components/construction/pills";
import { ProgressCards, ProgressTable, type ChapterPlans, type ProgressActions } from "../../components/construction/ProgressViews";
import { chip, muted } from "../../components/obra/classes";
import { useObraAction } from "../../components/obra/useObraAction";
import GeneratePlanForm from "../../components/planning/GeneratePlanForm";
import { planningHref } from "../../components/planning/links";
import { BaselineBanner, DraftNotice, NoPlanNotice, PlanKpis, useCalendarText } from "../../components/planning/PlanViews";
import ChapterProgress, { type ProgressRequest } from "../ChapterProgress";
import { UploadPhotos } from "../fotos/PhotosScreen";
import { IssueEditor } from "../incidencias/IssuesScreen";

/**
 * The plan and what really happens, in one list: each chapter's plan, real
 * dates and bar, where it is heading and the way to record its start and
 * finish; above it the approved baseline and its figures, or the way to a
 * first plan (the chapters then go on simulated dates).
 */
export default function PlanningScreen({
  projectId,
  header,
  control,
  planning,
  canManage,
}: {
  projectId: string;
  header: ObraHeader;
  control: ConstructionControl;
  planning: ProjectPlanning;
  canManage: boolean;
}) {
  const t = useTranslations("planning");
  const tc = useTranslations("construction.progress");
  const ts = useTranslations("construction.sources");
  const router = useRouter();
  const action = useObraAction();
  const calendarText = useCalendarText();
  const [state, setState] = useState<StateFilter>("all");
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [showPlan, setShowPlan] = useState(true);
  const [progress, setProgress] = useState<ProgressRequest>(null);
  // The chapter a new issue or photo is for ("" for none picked).
  const [issueFor, setIssueFor] = useState<string | null>(null);
  const [photoFor, setPhotoFor] = useState<string | null>(null);

  const { baseline, draft } = planning;
  const { today } = control;
  const editHref = planningHref(projectId, "editar");
  const openDraft = (input: PlanningDraftNewInput) =>
    action.run(() => createPlanningDraftAction(projectId, input), () => router.push(editHref));

  const plans: ChapterPlans | undefined = baseline ? new Map(baseline.rows.map((row) => [row.code, row])) : undefined;
  const chapters = inPlanOrder(control.chapters, baseline?.rows);
  const timeline = timelineOf(
    chapters,
    control.project,
    today,
    baseline ? baseline.rows.flatMap((r) => [r.forecastStart, r.forecastEnd]) : [],
  );
  // The state filter counts what the critical-path chip leaves.
  const pool = onlyCritical ? chapters.filter((c) => plans?.get(c.code)?.critical) : chapters;
  const shown = pool.filter((c) => state === "all" || c.state === state);
  const count = (s: string) => pool.filter((c) => c.state === s).length;
  const options = chapters.map(({ code, name }) => ({ code, name }));
  const href = (code: string) => chapterHref(projectId, code);

  const actions: ProgressActions | undefined = canManage
    ? {
        onStart: (code) => setProgress({ kind: "start", code }),
        onFinish: (code) => setProgress({ kind: "finish", code }),
        onCorrect: (code) => setProgress({ kind: "correct", code }),
        onIssue: (code) => setIssueFor(code),
        onPhoto: (code) => setPhotoFor(code),
      }
    : undefined;

  const aside = (baseline || canManage) && (
    <div className="flex flex-wrap gap-2">
      {canManage && (
        <Button type="button" variant="outline" onClick={() => setIssueFor("")}>
          {tc("recordIssue")}
        </Button>
      )}
      {baseline && (
        <Link href={planningHref(projectId, "versiones")} className={buttonVariants({ variant: "outline" })}>
          {t("versionsLink")}
        </Link>
      )}
      {baseline &&
        canManage &&
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

  // The plan above the chapters: the baseline, an open draft, or the way to a first plan.
  let plan: React.ReactNode = null;
  if (baseline) {
    plan = (
      <>
        <FormError namespace="planning.errors" error={action.state?.error} />
        <BaselineBanner baseline={baseline} />
        {draft && <DraftNotice draft={draft} href={editHref} canManage={canManage} />}
        <PlanKpis baseline={baseline} completionDate={planning.completionDate} />
      </>
    );
  } else if (draft) {
    plan = <DraftNotice draft={draft} href={editHref} canManage={canManage} />;
  } else if (planning.chapters.length > 0) {
    plan = (
      <NoPlanNotice
        chapterCount={planning.chapters.length}
        form={
          canManage && (
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
          )
        }
      />
    );
  }

  return (
    <ObraFrame projectId={projectId} header={header} current="planning" title={t("title")} description={t("description")} aside={aside}>
      {plan}

      {chapters.length === 0 ? (
        <p className={cn(cardVariants(), "text-center text-sm text-muted-foreground")}>
          {planning.chapters.length === 0 ? t("generate.noBudget") : tc("noChapters")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StateFilterBar
                value={state}
                onChange={setState}
                counts={{ all: pool.length, in_progress: count("in_progress"), pending: count("pending"), finished: count("finished") }}
              />
              {baseline && (
                <>
                  <button type="button" className={chip} aria-pressed={onlyCritical} onClick={() => setOnlyCritical((on) => !on)}>
                    {t("table.onlyCritical")}
                  </button>
                  {timeline && (
                    // The table draws its bars from xl (the phone cards always do).
                    <button type="button" className={cn(chip, "md:max-xl:hidden")} aria-pressed={showPlan} onClick={() => setShowPlan((on) => !on)}>
                      {t("table.compare")}
                    </button>
                  )}
                </>
              )}
            </div>
            {timeline && (
              <div className="md:max-xl:hidden">
                <GanttLegend
                  today={today}
                  baseline={!!baseline}
                  showPlan={showPlan}
                  planSource={
                    <span className="inline-flex items-center gap-1.5">
                      (<Source name={ts("planning")} mock={control.sources.planning === "mock"} />)
                    </span>
                  }
                />
              </div>
            )}
          </div>

          {shown.length === 0 ? (
            <p className={cn(cardVariants(), "text-center text-sm text-muted-foreground")}>{tc("noMatch")}</p>
          ) : (
            <>
              <ProgressTable chapters={shown} timeline={timeline} today={today} chapterHref={href} actions={actions} plans={plans} showPlan={showPlan} />
              <ProgressCards chapters={shown} timeline={timeline} today={today} chapterHref={href} actions={actions} plans={plans} showPlan={showPlan} />
            </>
          )}
        </>
      )}

      {baseline && <p className={cn(muted, "max-w-[90ch] leading-normal")}>{t("footnote", { calendar: calendarText(baseline.calendar) })}</p>}

      {canManage && (
        <>
          <ChapterProgress projectId={projectId} control={control} request={progress} onClose={() => setProgress(null)} />
          <Modal open={issueFor !== null} onOpenChange={(open) => !open && setIssueFor(null)} title={tc("recordIssue")} className="sm:max-w-[560px]">
            {issueFor !== null && (
              <IssueEditor
                projectId={projectId}
                chapters={options}
                today={today}
                chapterCode={issueFor || undefined}
                onDone={() => setIssueFor(null)}
                bare
              />
            )}
          </Modal>
          <Modal open={photoFor !== null} onOpenChange={(open) => !open && setPhotoFor(null)} title={tc("uploadPhoto")}>
            {photoFor !== null && (
              <UploadPhotos
                projectId={projectId}
                chapters={options}
                today={today}
                chapterCode={photoFor || undefined}
                onDone={() => setPhotoFor(null)}
                bare
              />
            )}
          </Modal>
        </>
      )}
    </ObraFrame>
  );
}

/**
 * The chapters in the approved plan's order (staff's, the order the works
 * read in), any the plan doesn't have after them in the budget's; without a
 * plan, the budget's order.
 */
function inPlanOrder(chapters: ControlChapter[], rows: { code: string }[] | undefined) {
  if (!rows) return chapters;
  const position = new Map(rows.map((row, index) => [row.code, index]));
  const at = (code: string) => position.get(code) ?? rows.length;
  // A stable sort: those the plan doesn't have keep the budget's order.
  return [...chapters].sort((a, b) => at(a.code) - at(b.code));
}
