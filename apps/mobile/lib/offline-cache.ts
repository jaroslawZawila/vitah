import { Directory, File, Paths } from "expo-file-system";

// The last successful answer of each main screen's data, so the app opens on
// a plot with no signal. One JSON file per user, per part and per home, in the
// app's cache directory (device backups leave it out; if the OS purges it the
// app simply loads from the network). Only what the screens already show:
// never a token or a password. Wiped on sign-out.

/** Raise it when the shape of a stored answer changes: older files are then ignored and deleted. */
export const OFFLINE_FORMAT = 1;

type Stored = { v: number; savedAt: string; data: unknown };

/** One stored answer: whose, which part (`obra`, `photos`…) and which home (none for the list of homes). */
export type OfflineKey = { userId: string; name: string; projectId?: string | null };

// Bumped on sign-out, so a load still running for the previous client knows
// to drop its answer instead of writing it back.
let session = 0;
export const offlineSession = () => session;

const safe = (part: string) => part.replace(/[^A-Za-z0-9_-]/g, "_");
const root = () => new Directory(Paths.cache, "offline");
const userDir = (userId: string) => new Directory(root(), safe(userId));
const fileOf = ({ userId, name, projectId }: OfflineKey) =>
  new File(userDir(userId), `${safe(name)}.${projectId ? safe(projectId) : "-"}.json`);

/** The stored answer and when it was saved; null when none, or when unreadable or in an older format (deleted then). */
export async function readOffline<T>(key: OfflineKey): Promise<{ data: T; savedAt: string } | null> {
  try {
    const file = fileOf(key);
    if (!file.exists) return null;
    try {
      const stored = JSON.parse(await file.text()) as Partial<Stored> | null;
      if (stored?.v === OFFLINE_FORMAT && typeof stored.savedAt === "string" && stored.data != null) {
        return { data: stored.data as T, savedAt: stored.savedAt };
      }
    } catch {
      // Broken file: dropped below.
    }
    file.delete();
  } catch {
    // The cache is only a convenience.
  }
  return null;
}

/** Keeps an answer. `started` is `offlineSession()` from when the load began. */
export function writeOffline(key: OfflineKey, data: unknown, started: number, now = new Date()) {
  if (started !== session) return;
  try {
    const file = fileOf(key);
    if (!file.exists) file.create({ intermediates: true });
    file.write(JSON.stringify({ v: OFFLINE_FORMAT, savedAt: now.toISOString(), data } satisfies Stored));
  } catch {
    // Not saved: the next load tries again.
  }
}

/** Drops what is kept for homes that are no longer the client's. */
export function pruneOffline(userId: string, homeIds: readonly string[]) {
  try {
    const dir = userDir(userId);
    if (!dir.exists) return;
    const keep = new Set(homeIds.map(safe));
    for (const entry of dir.list()) {
      if (!(entry instanceof File)) continue;
      const home = entry.name.split(".")[1];
      if (home && home !== "-" && !keep.has(home)) entry.delete();
    }
  } catch {
    // Left for the next list.
  }
}

/** Forgets everything on sign-out (the phone may be shared). */
export async function clearOffline() {
  session++;
  const dir = root();
  if (dir.exists) dir.delete();
}
