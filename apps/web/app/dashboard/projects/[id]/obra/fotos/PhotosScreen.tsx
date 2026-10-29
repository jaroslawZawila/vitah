"use client";

// Container for Obra › Fotos: the only part of it that knows about server
// actions. `UploadPhotos` is also used in a dialog by Avance and by a
// chapter's page. The views in ../../components/construction take props only.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { PhotoError, ProjectPhoto } from "@repo/core/contract";
import {
  addProjectPhotoAction,
  deleteProjectPhotoAction,
  setPhotoVisibilityAction,
  type PhotosState,
} from "../../../../../actions/photos";
import EmptyState from "../../components/EmptyState";
import { useObraAction } from "../../components/obra/useObraAction";
import { SleepingCamera } from "../../components/illustrations";
import { projectPhotoUrl } from "../../components/photoUrl";
import { usePhotoName } from "../../components/usePhotoName";
import FormError from "../../../../components/FormError";
import ObraFrame, { type ObraHeader } from "../../components/construction/ObraFrame";
import { PhotoGroups, PhotoUploadForm, usePhotoGroups, type PhotoGrouping, type PhotoUploadValues } from "../../components/construction/PhotoViews";
import Segmented from "../../components/construction/Segmented";

type Chapters = { code: string; name: string }[];

/** Uploads the photos picked one by one, each with the same date, caption and chapter. */
export function UploadPhotos({
  projectId,
  chapters,
  today,
  chapterCode,
  onDone,
  bare,
}: {
  projectId: string;
  chapters: Chapters;
  today: string;
  chapterCode?: string;
  /** After uploading or cancelling. */
  onDone: () => void;
  bare?: boolean;
}) {
  const [error, setError] = useState<PhotoError | undefined>();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pending, startTransition] = useTransition();
  // Bumped after an upload so the form empties.
  const [formKey, setFormKey] = useState(0);

  function upload(files: File[], values: PhotoUploadValues) {
    startTransition(async () => {
      setError(undefined);
      for (const [index, file] of files.entries()) {
        setProgress({ done: index + 1, total: files.length });
        const data = new FormData();
        data.set("file", file);
        data.set("takenOn", values.takenOn);
        if (values.caption) data.set("caption", values.caption);
        if (values.chapterCode) data.set("chapterCode", values.chapterCode);
        const state = await addProjectPhotoAction(projectId, null, data);
        if (!state?.success) {
          setProgress(null);
          setError(state?.error);
          return;
        }
      }
      setProgress(null);
      setFormKey((k) => k + 1);
      onDone();
    });
  }

  return (
    <PhotoUploadForm
      key={formKey}
      chapters={chapters}
      today={today}
      chapterCode={chapterCode}
      pending={pending}
      progress={progress}
      error={error}
      onSubmit={upload}
      onCancel={onDone}
      bare={bare}
    />
  );
}

/** The works' photos, by week or by chapter, with the upload form beside them. */
export default function PhotosScreen({
  projectId,
  header,
  photos,
  chapters,
  today,
  canManage,
}: {
  projectId: string;
  header: ObraHeader;
  photos: ProjectPhoto[];
  chapters: Chapters;
  today: string;
  canManage: boolean;
}) {
  const t = useTranslations("construction.photos");
  const [grouping, setGrouping] = useState<PhotoGrouping>("date");
  const { state, pending, run, confirmThen } = useObraAction<PhotosState>();
  const groups = usePhotoGroups(photos, grouping, chapters, today);
  const photoName = usePhotoName();

  return (
    <ObraFrame
      projectId={projectId}
      header={header}
      current="photos"
      title={
        <>
          {t("title")} <span className="num text-[0.7em] font-normal text-muted-foreground">{photos.length}</span>
        </>
      }
      description={t("description")}
    >
      <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label={t("listLabel")} className="flex min-w-0 flex-col gap-3.5">
          {photos.length === 0 ? (
            <EmptyState illustration={<SleepingCamera />} title={t("emptyTitle")} text={t("emptyText")} />
          ) : (
            <>
              <Segmented
                label={t("groupBy")}
                value={grouping}
                onChange={setGrouping}
                options={[
                  { key: "date", label: t("byDate") },
                  { key: "chapter", label: t("byChapter") },
                ]}
              />
              <FormError namespace="construction.photos.errors" error={state?.error} />
              <PhotoGroups
                groups={groups}
                grouping={grouping}
                fileUrl={(photo, size) => projectPhotoUrl(projectId, photo.id, size)}
                photoName={photoName}
                onToggleVisibility={
                  canManage
                    ? (photo, visibleToClient) => run(() => setPhotoVisibilityAction(projectId, photo.id, visibleToClient))
                    : undefined
                }
                onDelete={canManage ? (photo) => confirmThen(t("confirmDelete"), () => deleteProjectPhotoAction(projectId, photo.id)) : undefined}
                busy={pending}
              />
            </>
          )}
        </section>
        {canManage && (
          <div className="lg:sticky lg:top-4">
            <UploadPhotos projectId={projectId} chapters={chapters} today={today} onDone={() => undefined} />
          </div>
        )}
      </div>
    </ObraFrame>
  );
}
