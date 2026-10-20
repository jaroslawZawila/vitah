"use client";

// Container for a chapter's page under Obra › Avance: the only part of it
// that knows about server actions (with ChapterProgress, IssueEditor and
// UploadPhotos). The views in ../../../components/construction take props only.

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ConstructionControl, ControlChapterDetail } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { saveProgressAction } from "../../../../../../actions/obra";
import Modal from "../../../components/Modal";
import { useObraAction } from "../../../components/obra/useObraAction";
import { projectPhotoUrl } from "../../../components/photoUrl";
import { cardTop } from "../../../components/construction/classes";
import { ChapterPhotos, CostCard, DatesCard, LineProgressCard, MilestoneCard } from "../../../components/construction/ChapterViews";
import { HistoryTable } from "../../../components/construction/History";
import { IssueCard } from "../../../components/construction/IssueViews";
import { obraHref, StageEyebrow } from "../../../components/construction/ObraFrame";
import LateDeliveriesBanner from "../../../components/construction/LateDeliveriesBanner";
import { ChapterStatePill } from "../../../components/construction/pills";
import ChapterOrders from "../../../components/purchasing/ChapterOrders";
import { newOrderHref, orderHref, ordersViewHref } from "../../../components/purchasing/links";
import { completesMilestone } from "../../../components/construction/schedule";
import { SchedulePill } from "../../../components/construction/SummaryTable";
import ChapterProgress, { type ProgressRequest } from "../../ChapterProgress";
import { UploadPhotos } from "../../fotos/PhotosScreen";
import { IssueEditor, issueFileUrl } from "../../incidencias/IssuesScreen";
import BackLink from "../../../../../components/BackLink";

/** One chapter: its dates, hito, cost, issues, photos, lines' % and history. */
export default function ChapterScreen({
  projectId,
  control,
  detail,
  canManage,
}: {
  projectId: string;
  control: ConstructionControl;
  detail: ControlChapterDetail;
  canManage: boolean;
}) {
  const t = useTranslations("construction.chapter");
  const { chapter, milestone, today, sources } = detail;
  const [progress, setProgress] = useState<ProgressRequest>(null);
  // null: closed; "new", or the id of the issue being edited.
  const [issue, setIssue] = useState<string | null>(null);
  const editing = detail.issues.find((i) => i.id === issue) ?? null;
  const [photoOpen, setPhotoOpen] = useState(false);
  const [values, setValues] = useState<Record<string, number>>({});
  const lineSave = useObraAction();
  const chapters = control.chapters.map(({ code, name }) => ({ code, name }));
  const ends = new Map(control.chapters.map((c) => [c.code, c.actualEnd]));
  const changes = detail.lines
    .filter((line) => values[line.id] !== undefined && values[line.id] !== line.executedPct)
    .map((line) => ({ id: line.id, executedPct: values[line.id]! }));
  const open = (kind: "start" | "finish" | "correct") => setProgress({ kind, code: chapter.code });

  return (
    <div className="flex flex-col gap-[18px]">
      <BackLink href={obraHref(projectId, "progress")} />

      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <StageEyebrow label={milestone ? t("labelWithHito", { code: chapter.code, hito: milestone.code }) : t("label", { code: chapter.code })} />
            <ChapterStatePill state={chapter.state} />
            <SchedulePill chapter={chapter} today={today} long />
          </div>
          <h1 className="mt-1.5">{chapter.name}</h1>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setIssue("new")}>
              {t("recordIssue")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPhotoOpen(true)}>
              {t("uploadPhoto")}
            </Button>
            {chapter.state === "pending" && (
              <Button type="button" onClick={() => open("start")}>
                {t("start")}
              </Button>
            )}
            {chapter.state === "in_progress" && (
              <Button type="button" onClick={() => open("finish")}>
                {t("finish")}
              </Button>
            )}
          </div>
        )}
      </header>

      <LateDeliveriesBanner
        orders={detail.orders.filter((o) => o.lateDays !== null)}
        orderHref={(id) => orderHref(projectId, id)}
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-start gap-3.5">
        <DatesCard
          chapter={chapter}
          planningMock={sources.planning === "mock"}
          onCorrect={canManage && chapter.actualStart ? () => open("correct") : undefined}
        />
        {milestone && (
          <MilestoneCard
            milestone={milestone}
            code={chapter.code}
            completes={chapter.state === "in_progress" && completesMilestone(milestone, chapter.code)}
            actualEnd={(code) => ends.get(code) ?? null}
            paymentsHref={`/dashboard/projects/${projectId}/payments/${milestone.id}`}
          />
        )}
        <CostCard
          chapter={chapter}
          budgetNumber={control.budget?.number ?? null}
          costsHref={obraHref(projectId, "costs")}
        />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] items-start gap-3.5">
        <section className={cn(cardVariants(), "gap-3")} aria-labelledby="chapter-issues">
          <div className={cardTop}>
            <h2 id="chapter-issues">{t("issues")}</h2>
            {canManage && (
              <Button type="button" variant="outline" size="sm" onClick={() => setIssue("new")}>
                + {t("addIssue")}
              </Button>
            )}
          </div>
          {detail.issues.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">{t("noIssues")}</p>
          ) : (
            detail.issues.map((record) => (
              <IssueCard
                key={record.id}
                issue={record}
                fileUrl={(i, file) => issueFileUrl(projectId, i.id, file.id)}
                onEdit={canManage ? () => setIssue(record.id) : undefined}
              />
            ))
          )}
        </section>
        <ChapterPhotos
          photos={detail.photos}
          href={obraHref(projectId, "photos")}
          thumbUrl={(photo) => projectPhotoUrl(projectId, photo.id, "thumb")}
          fullUrl={(photo) => projectPhotoUrl(projectId, photo.id)}
        />
      </div>

      <ChapterOrders
        orders={detail.orders}
        orderHref={(order) => orderHref(projectId, order.id)}
        purchasesHref={ordersViewHref(projectId)}
        newOrderHref={canManage ? newOrderHref(projectId, chapter.code) : undefined}
      />

      <LineProgressCard
        lines={detail.lines}
        values={values}
        finished={chapter.state === "finished"}
        canEdit={canManage}
        dirty={changes.length > 0}
        pending={lineSave.pending}
        saved={!!lineSave.state?.success && changes.length === 0}
        error={lineSave.state?.error}
        onChange={(id, pct) => setValues((v) => ({ ...v, [id]: pct }))}
        onSave={() => lineSave.run(() => saveProgressAction(projectId, changes), () => setValues({}))}
      />

      <HistoryTable events={detail.events} />

      {canManage && (
        <>
          <ChapterProgress
            projectId={projectId}
            control={control}
            request={progress}
            onClose={() => setProgress(null)}
            avanceHref={obraHref(projectId, "progress")}
          />
          <Modal
            open={issue !== null}
            onOpenChange={(isOpen) => !isOpen && setIssue(null)}
            title={editing ? t("editIssue") : t("recordIssue")}
            className="sm:max-w-[560px]"
          >
            {issue !== null && (
              <IssueEditor
                projectId={projectId}
                chapters={chapters}
                today={today}
                issue={editing}
                chapterCode={chapter.code}
                onDone={() => setIssue(null)}
                bare
              />
            )}
          </Modal>
          <Modal open={photoOpen} onOpenChange={setPhotoOpen} title={t("uploadPhoto")}>
            {photoOpen && (
              <UploadPhotos
                projectId={projectId}
                chapters={chapters}
                today={today}
                chapterCode={chapter.code}
                onDone={() => setPhotoOpen(false)}
                bare
              />
            )}
          </Modal>
        </>
      )}
    </div>
  );
}
