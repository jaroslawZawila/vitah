import { Directory, File, Paths } from "expo-file-system";
import type { MobileDocument } from "@repo/core/contract";
import { api } from "./api";
import { downloadWithToken } from "./download";

// Offline copies of the client's documents, one folder per home (project):
// each PDF plus a manifest (the last list from the server and which documents
// were opened). Every home's copies stay until it is no longer the client's;
// everything is wiped on sign-out.
//
// They live in the app's cache directory, which device backups leave out
// (iOS: Library/Caches, never in iCloud or computer backups; Android: the
// cache dir, never in Auto Backup or a device transfer): contracts and
// invoices must not travel unencrypted in a backup. The OS may empty it when
// the phone runs short of space; the next sync (app open, foreground, pull to
// refresh) downloads them again. Builds before this kept them in the document
// directory, which iOS backs up: the first run moves them here.

export type LocalDocument = MobileDocument & {
  /** The PDF is on the phone. */
  downloaded: boolean;
  /** Not opened on this phone yet. */
  isNew: boolean;
};

type Manifest = { documents: MobileDocument[]; seen: string[] };

const place = () => new Directory(Paths.cache, "documents");
/** Where earlier builds kept them: backed up on iOS. */
const formerPlace = () => new Directory(Paths.document, "documents");

let moved = false;
/**
 * Takes the copies out of the backed-up document directory, once per run:
 * moved whole when there is nothing here yet (the manifests keep which were
 * opened), else dropped. Should moving fail they are dropped too, and the
 * next sync downloads them again.
 */
function leaveBackups() {
  moved = true;
  try {
    if (!formerPlace().exists) return;
    try {
      if (!place().exists) formerPlace().moveSync(place());
    } finally {
      // A fresh handle: a moved one points at its new place.
      const left = formerPlace();
      if (left.exists) left.delete();
    }
  } catch {
    // Never worth stopping the app for: tried again on its next run.
  }
}

const root = () => {
  if (!moved) leaveBackups();
  return place();
};
const folder = (projectId: string) => new Directory(root(), projectId);

// Bumped on sign-out, so a sync still running for the previous client knows
// to discard its work instead of writing their documents back.
let session = 0;
const manifestFile = (projectId: string) => new File(folder(projectId), "manifest.json");
export const documentFile = (projectId: string, id: string) => new File(folder(projectId), `${id}.pdf`);

async function readManifest(projectId: string): Promise<Manifest> {
  const file = manifestFile(projectId);
  if (!file.exists) return { documents: [], seen: [] };
  try {
    return JSON.parse(await file.text()) as Manifest;
  } catch {
    return { documents: [], seen: [] };
  }
}

function writeManifest(projectId: string, manifest: Manifest) {
  const file = manifestFile(projectId);
  if (!file.exists) file.create({ intermediates: true });
  file.write(JSON.stringify(manifest));
}

function toLocal(projectId: string, { documents, seen }: Manifest): LocalDocument[] {
  return documents.map((doc) => ({
    ...doc,
    downloaded: documentFile(projectId, doc.id).exists,
    isNew: !seen.includes(doc.id),
  }));
}

/** A home's documents as last synced, readable offline. */
export async function readDocuments(projectId: string): Promise<LocalDocument[]> {
  return toLocal(projectId, await readManifest(projectId));
}

async function download(token: string, projectId: string, doc: MobileDocument) {
  const file = documentFile(projectId, doc.id);
  if (file.exists) return;
  // Retried on the next sync; `downloadWithToken` leaves no partial file.
  await downloadWithToken(api.documentUrl(doc.id), file, token).catch(() => {});
}

/**
 * Fetches a home's list, downloads new PDFs and deletes removed ones, then
 * returns the documents. Returns the API error instead when the list can't be
 * fetched; local copies stay untouched then. Stops between downloads, with
 * `stopped`, once `wanted` says that home is no longer shown.
 */
export async function syncDocuments(token: string, projectId: string, wanted: () => boolean = () => true) {
  const started = session;
  const result = await api.listDocuments(token, projectId);
  if (!result.ok) return { error: result.error };
  if (session !== started) return { error: "signed_out" as const };

  const { documents } = result.data;
  const ids = new Set(documents.map((doc) => doc.id));
  const dir = folder(projectId);
  dir.create({ intermediates: true, idempotent: true });

  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name.endsWith(".pdf") && !ids.has(entry.name.slice(0, -4))) {
      entry.delete();
    }
  }
  // One at a time: up to 4 MB each over a phone connection.
  for (const doc of documents) {
    if (session !== started) break;
    if (!wanted()) return { error: "stopped" as const };
    await download(token, projectId, doc);
  }
  if (session !== started) {
    for (const doc of documents) {
      const file = documentFile(projectId, doc.id);
      if (file.exists) file.delete();
    }
    return { error: "signed_out" as const };
  }

  const { seen } = await readManifest(projectId);
  const manifest = { documents, seen: seen.filter((id) => ids.has(id)) };
  writeManifest(projectId, manifest);
  return { documents: toLocal(projectId, manifest) };
}

export async function markSeen(projectId: string, id: string) {
  const manifest = await readManifest(projectId);
  if (manifest.seen.includes(id)) return;
  writeManifest(projectId, { ...manifest, seen: [...manifest.seen, id] });
}

/**
 * Deletes the copies of homes that are no longer the client's (`keep` are
 * theirs), and those kept before the app knew about several homes.
 */
export function pruneDocuments(keep: readonly string[]) {
  const dir = root();
  if (!dir.exists) return;
  for (const entry of dir.list()) {
    if (entry instanceof File || !keep.includes(entry.name)) entry.delete();
  }
}

export function clearDocuments() {
  session++;
  const dir = root();
  if (dir.exists) dir.delete();
}
