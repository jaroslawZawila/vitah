"use client";

// Container for Obra › Avance: the only part of it that knows about server
// actions (through ChapterProgress, IssueEditor and UploadPhotos). The views
// in ../../components/construction take props only.

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ConstructionControl } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import Modal from "../../components/Modal";
import { StateFilterBar, type StateFilter } from "../../components/construction/Filters";
import { GanttLegend, timelineOf } from "../../components/construction/Gantt";
import { RecentEvents } from "../../components/construction/History";
import ObraFrame, { chapterHref, type ObraHeader } from "../../components/construction/ObraFrame";
import { Source } from "../../components/construction/pills";
import { ProgressCards, ProgressTable, type ProgressActions } from "../../components/construction/ProgressViews";
import ChapterProgress, { type ProgressRequest } from "../ChapterProgress";
import { UploadPhotos } from "../fotos/PhotosScreen";
import { IssueEditor } from "../incidencias/IssuesScreen";

/** Record when each chapter really starts and finishes: the only thing that changes its state. */
export default function AvanceScreen({
  projectId,
  header,
  control,
  canManage,
}: {
  projectId: string;
  header: ObraHeader;
  control: ConstructionControl;
  canManage: boolean;
}) {
  const t = useTranslations("construction.progress");
  const ts = useTranslations("construction.sources");
  const [state, setState] = useState<StateFilter>("all");
  const [progress, setProgress] = useState<ProgressRequest>(null);
  // The chapter a new issue or photo is for ("" for none picked).
  const [issueFor, setIssueFor] = useState<string | null>(null);
  const [photoFor, setPhotoFor] = useState<string | null>(null);
  const { chapters, today } = control;
  const timeline = timelineOf(chapters, control.project, today);
  const shown = chapters.filter((c) => state === "all" || c.state === state);
  const count = (s: string) => chapters.filter((c) => c.state === s).length;
  const options = chapters.map(({ code, name }) => ({ code, name }));

  const actions: ProgressActions | undefined = canManage
    ? {
        onStart: (code) => setProgress({ kind: "start", code }),
        onFinish: (code) => setProgress({ kind: "finish", code }),
        onCorrect: (code) => setProgress({ kind: "correct", code }),
        onIssue: (code) => setIssueFor(code),
        onPhoto: (code) => setPhotoFor(code),
      }
    : undefined;

  return (
    <ObraFrame
      projectId={projectId}
      header={header}
      current="progress"
      title={t("title")}
      description={t("description")}
      aside={
        canManage && (
          <Button type="button" variant="outline" onClick={() => setIssueFor("")}>
            {t("recordIssue")}
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StateFilterBar
          value={state}
          onChange={setState}
          order={["all", "in_progress", "pending", "finished"]}
          counts={{ all: chapters.length, in_progress: count("in_progress"), pending: count("pending"), finished: count("finished") }}
        />
        {timeline && (
          <GanttLegend
            today={today}
            planSource={
              <span className="inline-flex items-center gap-1.5 text-[11.5px]">
                (<Source name={ts("planning")} mock={control.sources.planning === "mock"} />)
              </span>
            }
          />
        )}
      </div>

      {chapters.length === 0 ? (
        <p className={cn(cardVariants(), "text-center text-[13.5px] text-muted-foreground")}>{t("noChapters")}</p>
      ) : (
        <>
          <ProgressTable
            chapters={shown}
            timeline={timeline}
            today={today}
            chapterHref={(code) => chapterHref(projectId, code)}
            actions={actions}
          />
          <ProgressCards
            chapters={shown}
            timeline={timeline}
            today={today}
            chapterHref={(code) => chapterHref(projectId, code)}
            actions={actions}
            showingAll={state === "all"}
            onShowState={setState}
          />
        </>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-3.5">
        <RecentEvents events={control.events} />
        <section className={cn(cardVariants(), "gap-2.5")} aria-labelledby="how-it-works">
          <h2 id="how-it-works">{t("howTitle")}</h2>
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-snug">
            {(["start", "finish", "cancel", "planning"] as const).map((key) => (
              <li key={key}>{t.rich(`how.${key}`, { b: (chunks) => <b>{chunks}</b> })}</li>
            ))}
          </ul>
        </section>
      </div>

      {canManage && (
        <>
          <ChapterProgress projectId={projectId} control={control} request={progress} onClose={() => setProgress(null)} />
          <Modal open={issueFor !== null} onOpenChange={(open) => !open && setIssueFor(null)} title={t("recordIssue")} className="sm:max-w-[560px]">
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
          <Modal open={photoFor !== null} onOpenChange={(open) => !open && setPhotoFor(null)} title={t("uploadPhoto")}>
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
