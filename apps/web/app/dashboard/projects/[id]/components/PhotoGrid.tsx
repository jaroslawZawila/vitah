"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { PhotoError, ProjectPhoto } from "@repo/core/contract";
import FormError from "./FormError";
import styles from "./photos.module.css";

/** Presentational: the project's photos as a grid; each opens full size. */
export default function PhotoGrid({
  photos,
  fileUrl,
  onDelete,
  deleting,
  error,
}: {
  photos: ProjectPhoto[];
  fileUrl: (photo: ProjectPhoto) => string;
  /** Omitted for users who can't delete. */
  onDelete?: (photo: ProjectPhoto) => void;
  deleting: boolean;
  error?: PhotoError;
}) {
  const t = useTranslations("projectDetailPage.photos");
  const format = useFormatter();

  return (
    <>
      <FormError namespace="projectDetailPage.photos.errors" error={error} />
      <ul className={styles.grid}>
        {photos.map((photo) => {
          const date = format.dateTime(new Date(photo.uploadedAt), {
            dateStyle: "medium",
            // Fixed zone: server and browser must render the same text.
            timeZone: "Europe/Madrid",
          });
          const name = photo.caption ?? t("untitled", { date });
          const url = fileUrl(photo);
          return (
            <li key={photo.id} className={styles.tile}>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                title={t("open")}
                className={styles.imageLink}
              >
                {/* Served by our authenticated API, so next/image can't optimise it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={name} loading="lazy" className={styles.image} />
              </a>
              <div className={styles.details}>
                <div className={styles.text}>
                  {photo.caption && <span className={styles.caption}>{photo.caption}</span>}
                  <span className={styles.meta}>
                    {[date, photo.uploadedBy].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {onDelete && (
                  <button
                    type="button"
                    className={styles.delete}
                    onClick={() => onDelete(photo)}
                    disabled={deleting}
                    aria-label={t("deleteLabel", { name })}
                  >
                    {t("delete")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
