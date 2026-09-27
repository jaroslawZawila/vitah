"use client";

import type { ProjectPhoto } from "@repo/core/contract";
import { usePhotoName } from "../usePhotoName";
import styles from "./obra.module.css";

/** Presentational: a grid of photo thumbnails (optionally selectable). */
export default function PhotoStrip({
  photos,
  thumbUrl,
  selected,
  onToggle,
  toggleLabel,
}: {
  photos: ProjectPhoto[];
  thumbUrl: (photo: ProjectPhoto) => string;
  selected?: Set<string>;
  onToggle?: (photo: ProjectPhoto) => void;
  toggleLabel?: (photo: ProjectPhoto) => string;
}) {
  const name = usePhotoName();

  return (
    <div className={styles.photos}>
      {photos.map((photo) =>
        onToggle ? (
          <label key={photo.id} className={styles.pickable}>
            <input
              type="checkbox"
              checked={selected?.has(photo.id) ?? false}
              onChange={() => onToggle(photo)}
              aria-label={toggleLabel?.(photo) ?? name(photo)}
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- served by our API with the session */}
            <img src={thumbUrl(photo)} alt="" className={styles.photo} loading="lazy" />
          </label>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- served by our API with the session
          <img key={photo.id} src={thumbUrl(photo)} alt={name(photo)} className={styles.photo} loading="lazy" />
        ),
      )}
    </div>
  );
}
