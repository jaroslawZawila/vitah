"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { PhotoError, PhotoSize, ProjectPhoto } from "@repo/core/contract";
import FormError from "../../../components/FormError";
import { usePhotoName } from "./usePhotoName";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";

/** Presentational: the project's photos as a grid of thumbnails; each opens full size. */
export default function PhotoGrid({
  photos,
  fileUrl,
  onDelete,
  deleting,
  error,
}: {
  photos: ProjectPhoto[];
  fileUrl: (photo: ProjectPhoto, size: PhotoSize) => string;
  /** Omitted for users who can't delete. */
  onDelete?: (photo: ProjectPhoto) => void;
  deleting: boolean;
  error?: PhotoError;
}) {
  const t = useTranslations("projectDetailPage.photos");
  const format = useFormatter();
  const photoName = usePhotoName();

  return (
    <>
      <FormError namespace="projectDetailPage.photos.errors" error={error} />
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(140px,100%),1fr))] gap-3 md:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] md:gap-3.5">
        {photos.map((photo) => {
          const date = format.dateTime(new Date(photo.uploadedAt), {
            dateStyle: "medium",
            // Fixed zone: server and browser must render the same text.
            timeZone: "Europe/Madrid",
          });
          const name = photoName(photo);
          return (
            <li key={photo.id} className={cardVariants({ size: "flush" })}>
              <a
                href={fileUrl(photo, "full")}
                target="_blank"
                rel="noreferrer"
                title={t("open")}
                className="block aspect-square bg-raise focus-visible:-outline-offset-2"
              >
                {/* Served by our authenticated API, so next/image can't optimise it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl(photo, "thumb")}
                  alt={name}
                  loading="lazy"
                  className="block size-full object-cover"
                />
              </a>
              <div className="flex items-start gap-1 py-2 pr-1 pl-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
                  {photo.caption && (
                    <span className="text-[13px] font-semibold wrap-anywhere">{photo.caption}</span>
                  )}
                  <span className="text-xs wrap-anywhere text-muted-foreground">
                    {[date, photo.uploadedBy].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {onDelete && (
                  <Button
                    type="button"
                    variant="ghost-destructive"
                    size="sm"
                    onClick={() => onDelete(photo)}
                    disabled={deleting}
                    aria-label={t("deleteLabel", { name })}
                  >
                    {t("delete")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
