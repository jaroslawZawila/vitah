import { Directory, File, Paths } from "expo-file-system";
import type { MobileDocument } from "@repo/core/contract";
import { api } from "./api";
import { downloadWithToken } from "./download";

// Offline copies of the client's documents, one folder per home (project):
// each PDF plus a manifest (the last list from the server and which documents
// were opened) in the app's private document directory. Every home's copies
// stay until it is no longer the client's; everything is wiped on sign-out.

export type LocalDocument = MobileDocument & {
  /** The PDF is on the phone. */
  downloaded: boolean;
  /** Not opened on this phone yet. */
  isNew: boolean;
};

type Manifest = { documents: MobileDocument[]; seen: string[] };

const root = () => new Directory(Paths.document, "documents");
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
