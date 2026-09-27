"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ProjectPhoto } from "@repo/core/contract";

/** A photo's caption, or "Foto del 22 sept 2026" without one. */
export function usePhotoName() {
  const t = useTranslations("projectDetailPage.photos");
  const format = useFormatter();
  return (photo: ProjectPhoto) =>
    photo.caption ??
    t("untitled", {
      date: format.dateTime(new Date(photo.uploadedAt), {
        dateStyle: "medium",
        // Fixed zone: server and browser must render the same text.
        timeZone: "Europe/Madrid",
      }),
    });
}
