import { Directory, File, Paths } from "expo-file-system";
import type { MobileDocument } from "@repo/core/contract";
import { api } from "./api";

// Offline copies of the client's documents: each PDF plus a manifest (the last
// list from the server and which documents were opened) in the app's private
// document directory. Everything is wiped on sign-out.

export type LocalDocument = MobileDocument & {
  /** The PDF is on the phone. */
  downloaded: boolean;
  /** Not opened on this phone yet. */
  isNew: boolean;
};

type Manifest = { documents: MobileDocument[]; seen: string[] };

const folder = () => new Directory(Paths.document, "documents");

// Bumped on sign-out, so a sync still running for the previous client knows
// to discard its work instead of writing their documents back.
let session = 0;
const manifestFile = () => new File(folder(), "manifest.json");
export const documentFile = (id: string) => new File(folder(), `${id}.pdf`);

async function readManifest(): Promise<Manifest> {
  const file = manifestFile();
  if (!file.exists) return { documents: [], seen: [] };
  try {
    return JSON.parse(await file.text()) as Manifest;
  } catch {
    return { documents: [], seen: [] };
  }
}

function writeManifest(manifest: Manifest) {
  const file = manifestFile();
  if (!file.exists) file.create({ intermediates: true });
  file.write(JSON.stringify(manifest));
}

function toLocal({ documents, seen }: Manifest): LocalDocument[] {
  return documents.map((doc) => ({
    ...doc,
    downloaded: documentFile(doc.id).exists,
    isNew: !seen.includes(doc.id),
  }));
}

/** Documents as last synced, readable offline. */
export async function readDocuments(): Promise<LocalDocument[]> {
  return toLocal(await readManifest());
}

async function download(token: string, doc: MobileDocument) {
  const file = documentFile(doc.id);
  if (file.exists) return;
  try {
    await File.downloadFileAsync(api.documentUrl(doc.id), file, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Retried on the next sync; never keep a partial file.
    if (file.exists) file.delete();
  }
}

/**
 * Fetches the list, downloads new PDFs and deletes removed ones, then returns
 * the documents. Returns the API error instead when the list can't be
 * fetched; local copies stay untouched then.
 */
export async function syncDocuments(token: string) {
  const started = session;
  const result = await api.listDocuments(token);
  if (!result.ok) return { error: result.error };
  if (session !== started) return { error: "signed_out" as const };

  const { documents } = result.data;
  const ids = new Set(documents.map((doc) => doc.id));
  folder().create({ intermediates: true, idempotent: true });

  for (const entry of folder().list()) {
    if (entry instanceof File && entry.name.endsWith(".pdf") && !ids.has(entry.name.slice(0, -4))) {
      entry.delete();
    }
  }
  // One at a time: up to 4 MB each over a phone connection.
  for (const doc of documents) {
    if (session !== started) break;
    await download(token, doc);
  }
  if (session !== started) {
    for (const doc of documents) {
      const file = documentFile(doc.id);
      if (file.exists) file.delete();
    }
    return { error: "signed_out" as const };
  }

  const { seen } = await readManifest();
  const manifest = { documents, seen: seen.filter((id) => ids.has(id)) };
  writeManifest(manifest);
  return { documents: toLocal(manifest) };
}

export async function markSeen(id: string) {
  const manifest = await readManifest();
  if (manifest.seen.includes(id)) return;
  writeManifest({ ...manifest, seen: [...manifest.seen, id] });
}

export function clearDocuments() {
  session++;
  const dir = folder();
  if (dir.exists) dir.delete();
}
