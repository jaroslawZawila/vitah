"use client";

// Container for the Photos tab: the only part that knows about server
// actions. The views in ../components take props only.

import { useActionState, useState, useTransition } from "react";
import { ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { photoSizeQuery, type ProjectPhoto } from "@repo/core/contract";
import {
  addProjectPhotoAction,
  deleteProjectPhotoAction,
  type PhotosState,
} from "../../../../actions/photos";
import EmptyState from "../components/EmptyState";
import { SleepingCamera } from "../components/illustrations";
import Modal from "../components/Modal";
import PhotoGrid from "../components/PhotoGrid";
import PhotoUploadForm from "../components/PhotoUploadForm";
import TabHeader from "../components/TabHeader";
import tabStyles from "../components/TabHeader.module.css";

/** Site photos shared with the project's client in the mobile app. */
export default function PhotosScreen({
  projectId,
  projectRef,
  photos,
  canManage,
}: {
  projectId: string;
  projectRef: string;
  photos: ProjectPhoto[];
  canManage: boolean;
}) {
  const t = useTranslations("projectDetailPage.photos");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<PhotosState>(null);
  const [deleting, startDelete] = useTransition();

  function handleDelete(photo: ProjectPhoto) {
    if (!confirm(t("confirmDelete"))) return;
    startDelete(async () => {
      setDeleteState(await deleteProjectPhotoAction(projectId, photo.id));
    });
  }

  return (
    <>
      <TabHeader
        projectRef={projectRef}
        title={t("title")}
        summary={t("count", { count: photos.length })}
        action={
          canManage && (
            <button type="button" className={tabStyles.action} onClick={() => setUploadOpen(true)}>
              <ImagePlus size={16} aria-hidden />
              {t("upload")}
            </button>
          )
        }
      />

      {photos.length === 0 ? (
        <EmptyState
          illustration={<SleepingCamera />}
          title={t("emptyTitle")}
          text={t("emptyText")}
        />
      ) : (
        <PhotoGrid
          photos={photos}
          fileUrl={(photo, size) =>
            `/api/v1/projects/${projectId}/photos/${photo.id}${photoSizeQuery(size)}`
          }
          onDelete={canManage ? handleDelete : undefined}
          deleting={deleting}
          error={deleteState?.error}
        />
      )}

      {canManage && (
        <Modal open={uploadOpen} onOpenChange={setUploadOpen} title={t("upload")}>
          <UploadPhoto projectId={projectId} onDone={() => setUploadOpen(false)} />
        </Modal>
      )}
    </>
  );
}

/** Mounted only while the modal is open, so each upload starts afresh. */
function UploadPhoto({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [state, upload, uploading] = useActionState(
    async (prev: PhotosState, formData: FormData) => {
      const result = await addProjectPhotoAction(projectId, prev, formData);
      if (result?.success) onDone();
      return result;
    },
    null,
  );
  return (
    <PhotoUploadForm action={upload} pending={uploading} error={state?.error} onCancel={onDone} />
  );
}
