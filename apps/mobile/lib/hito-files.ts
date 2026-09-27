import { Directory, File, Paths } from "expo-file-system";
import type { HitoFileKind } from "@repo/core/contract";
import { api } from "./api";
import { downloadWithToken } from "./download";
import { openPdf } from "./open-pdf";

// A hito's signed acta or invoice, opened from the app. Each open downloads a
// fresh copy (staff may replace it) into its own file, so two opens at once
// don't clash. Everything is wiped on sign-out: invoices carry the client's
// name and amounts.

const folder = () => new Directory(Paths.cache, "hito-files");

export async function openHitoFile(token: string, hitoId: string, kind: HitoFileKind) {
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, `${hitoId}-${kind}-${Date.now()}.pdf`);
  await downloadWithToken(api.hitoFileUrl(hitoId, kind), file, token);
  await openPdf(file);
}

/** Deletes every downloaded acta and invoice (sign-out). */
export function clearHitoFiles() {
  const dir = folder();
  if (dir.exists) dir.delete();
}
