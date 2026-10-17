"use client";

import { useTranslations } from "next-intl";
import type { ProjectPhoto } from "@repo/core/contract";
import { useObraFormat } from "./obra/format";

/** A photo's caption, or "Foto del 22 sept 2026" (the day it was taken) without one. */
export function usePhotoName() {
  const t = useTranslations("construction.photos");
  const f = useObraFormat();
  return (photo: ProjectPhoto) => photo.caption ?? t("untitled", { date: f.date(photo.takenOn) });
}
