"use client";

// Container for the dialogs that start, finish and correct a chapter: the
// only part of them that knows about server actions. Used by Avance and by a
// chapter's page; the views are in ../components/construction.

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ConstructionControl } from "@repo/core/contract";
import { correctChapterAction, finishChapterAction, startChapterAction } from "../../../../actions/construction";
import Modal from "../components/Modal";
import { useObraAction } from "../components/obra/useObraAction";
import {
  CorrectDialog,
  FinishDialog,
  FinishedNotice,
  StartDialog,
  type FinishContext,
} from "../components/construction/ProgressDialogs";
import { completesMilestone } from "../components/construction/schedule";

export type ProgressRequest = { kind: "start" | "finish" | "correct"; code: string } | null;

/** What the dialogs need of the project's control. */
export type ProgressControl = Pick<ConstructionControl, "chapters" | "milestones" | "project" | "today" | "sources">;

export default function ChapterProgress({
  projectId,
  control,
  request,
  onClose,
  avanceHref,
}: {
  projectId: string;
  control: ProgressControl;
  request: ProgressRequest;
  onClose: () => void;
  /** Offered after finishing, on pages other than Avance. */
  avanceHref?: string;
}) {
  const t = useTranslations("construction.dialogs");
  const chapter = request && control.chapters.find((c) => c.code === request.code);
  if (!request || !chapter) return null;

  const title =
    request.kind === "start"
      ? t("startTitle", { name: chapter.name })
      : request.kind === "finish"
        ? t("finishTitle", { name: chapter.name })
        : t("correctTitle", { name: chapter.name });

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      className={request.kind === "finish" ? "sm:max-w-[760px]" : undefined}
    >
      {/* Keyed so each opening starts afresh. */}
      <Dialog key={`${request.kind}-${request.code}`} projectId={projectId} control={control} request={request} onClose={onClose} avanceHref={avanceHref} />
    </Modal>
  );
}

function Dialog({
  projectId,
  control,
  request,
  onClose,
  avanceHref,
}: {
  projectId: string;
  control: ProgressControl;
  request: NonNullable<ProgressRequest>;
  onClose: () => void;
  avanceHref?: string;
}) {
  const { state, pending, run } = useObraAction();
  // What finishing did, kept as it was when confirmed (the refreshed control has moved on).
  const [finished, setFinished] = useState<{ date: string; context: FinishContext } | null>(null);
  const chapter = control.chapters.find((c) => c.code === request.code)!;
  const { code } = chapter;

  if (request.kind === "start") {
    return (
      <StartDialog
        chapter={chapter}
        planningMock={control.sources.planning === "mock"}
        today={control.today}
        pending={pending}
        error={state?.error}
        onSubmit={(date) => run(() => startChapterAction(projectId, code, date), onClose)}
        onCancel={onClose}
      />
    );
  }

  if (request.kind === "correct") {
    return (
      <CorrectDialog
        chapter={chapter}
        today={control.today}
        pending={pending}
        error={state?.error}
        onSubmit={(input) => run(() => correctChapterAction(projectId, code, input), onClose)}
        onCancel={onClose}
      />
    );
  }

  const milestone = control.milestones.find((m) => m.code === chapter.hitoCode) ?? null;
  const context: FinishContext = {
    projectRef: control.project.ref,
    projectAddress: control.project.address,
    clientName: control.project.clientName,
    milestone,
    completes: completesMilestone(milestone, code),
  };

  if (finished) {
    return (
      <FinishedNotice
        chapter={chapter}
        planningMock={control.sources.planning === "mock"}
        date={finished.date}
        context={finished.context}
        avanceHref={avanceHref}
        onClose={onClose}
      />
    );
  }
  return (
    <FinishDialog
      chapter={chapter}
      planningMock={control.sources.planning === "mock"}
      context={context}
      today={control.today}
      pending={pending}
      error={state?.error}
      onSubmit={(date) => {
        // What the server did, not what the page predicted: someone else may have finished a sibling meanwhile.
        let requested = false;
        run(
          async () => {
            const result = await finishChapterAction(projectId, code, date);
            requested = Boolean(result?.invoiceRequested);
            return result;
          },
          () => setFinished({ date, context: { ...context, completes: requested } }),
        );
      }}
      onCancel={onClose}
    />
  );
}
