"use client";

import type { ProjectPhoto } from "@repo/core/contract";
import { usePhotoName } from "../usePhotoName";

const PHOTO = "block aspect-square w-full rounded-md border bg-raise object-cover";

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
    <div className="grid grid-cols-3 gap-2">
      {photos.map((photo) =>
        onToggle ? (
          <label key={photo.id} className="group relative block cursor-pointer">
            <input
              type="checkbox"
              className="absolute top-1.5 left-1.5 size-[22px] accent-primary"
              checked={selected?.has(photo.id) ?? false}
              onChange={() => onToggle(photo)}
              aria-label={toggleLabel?.(photo) ?? name(photo)}
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- served by our API with the session */}
            <img
              src={thumbUrl(photo)}
              alt=""
              className={`${PHOTO} group-has-checked:outline-3 group-has-checked:-outline-offset-3 group-has-checked:outline-primary`}
              loading="lazy"
            />
          </label>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- served by our API with the session
          <img key={photo.id} src={thumbUrl(photo)} alt={name(photo)} className={PHOTO} loading="lazy" />
        ),
      )}
    </div>
  );
}
