import { File } from "expo-file-system";
import { useEffect, useRef } from "react";
import { MAX_PHOTO_BYTES } from "@repo/core/contract";
import { useProject } from "./use-project";

// Garantía (doc/mobile-app-design/A-Warranty.dc.html): what its screens share.

/**
 * A key the server remembers a create by (16–100 letters, digits, - or _):
 * sent again with a retry, the claim or photo is made once.
 */
export function newIdempotencyKey() {
  const part = () => Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  return `${Date.now().toString(36)}-${part()}-${part()}`;
}

/** A photo picked on the phone, ready to upload. */
export type PickedPhoto = { uri: string; name: string; type: string; size: number | null };

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** The size of the file at `uri`; null when it can't be read (the server then says if it is too large). */
function sizeOf(uri: string): number | null {
  try {
    return new File(uri).size || null;
  } catch {
    return null;
  }
}

/**
 * The image picker's asset as the upload takes it; null when it is too large
 * to send. What goes up is the picker's re-encoded copy at `uri`: on Android
 * the asset's `fileSize` and `mimeType` describe the original in the gallery
 * (expo-image-picker's MediaHandler.kt), so the file itself is measured and
 * its type read from its extension.
 */
export function pickedPhoto(asset: { uri: string; fileName?: string | null; mimeType?: string }): PickedPhoto | null {
  const size = sizeOf(asset.uri);
  if (size !== null && size > MAX_PHOTO_BYTES) return null;
  const type = TYPES[/\.(\w+)$/.exec(asset.uri)?.[1]?.toLowerCase() ?? ""] ?? asset.mimeType ?? "image/jpeg";
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return { uri: asset.uri, name: asset.fileName || `foto.${extension}`, type, size };
}

/**
 * Reloads a warranty screen when the home's record does: the live updates
 * move the home's `project` counter for every claim change (staff's answer,
 * a new status), and that reloads the list of homes.
 */
export function useReloadWithHome(reload: () => unknown) {
  const { project } = useProject();
  const seen = useRef(project);
  useEffect(() => {
    if (seen.current === project) return;
    seen.current = project;
    void reload();
  }, [project, reload]);
}
