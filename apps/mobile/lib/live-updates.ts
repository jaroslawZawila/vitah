import { useEffect } from "react";
import { AppState } from "react-native";
import { CHANGE_AREAS, type ChangeArea, type MobileChanges } from "@repo/core/contract";
import { api } from "./api";
import { useAuth } from "./auth";
import { useDocuments } from "./documents";
import { useObra } from "./use-obra";
import { usePhotos } from "./use-photos";
import { useProject } from "./use-project";

/** How often the open app asks whether anything changed. */
export const POLL_MS = 30_000;

/**
 * The parts of the app to reload between two readings of the counters: all of
 * them when the client got, lost or changed project.
 */
export function changedAreas(
  before: MobileChanges | null,
  after: MobileChanges | null,
): readonly ChangeArea[] {
  if (before?.projectId !== after?.projectId) return CHANGE_AREAS;
  if (!before || !after) return [];
  return CHANGE_AREAS.filter((area) => before[area] !== after[area]);
}

/**
 * While the app is in the foreground, polls the server's change counters and
 * quietly reloads what staff changed. The first reading after the app opens
 * only sets the baseline: every part loads then anyway. Back in the
 * foreground the first reading is compared with the last one from before, so
 * a change that lands while the parts reload on their own isn't missed.
 * Needs the project, photos, documents and obra providers above it.
 */
export function useLiveUpdates() {
  const { token, signOut } = useAuth();
  // Stable while the token is: a new token starts polling afresh anyway.
  const { reload: project } = useProject();
  const { reload: obra } = useObra();
  const { reload: photos } = usePhotos();
  const { reload: documents } = useDocuments();

  useEffect(() => {
    const reloaders: Record<ChangeArea, () => Promise<void>> = { project, obra, photos, documents };
    if (!token) return;
    // `undefined`: no reading yet.
    let last: MobileChanges | null | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let polling = false;
    // Bumped on every start and stop, so a reply that arrives late is dropped.
    let epoch = 0;

    const poll = async () => {
      // On a slow network, the next poll waits for this one rather than racing it.
      if (polling) return;
      polling = true;
      const current = epoch;
      const result = await api.getChanges(token).finally(() => (polling = false));
      if (current !== epoch) return;
      if (!result.ok) {
        // Access revoked in the portal: nothing else is loading to notice.
        if (result.error === "unauthorized") await signOut();
        return; // Any other failure is left to the next poll.
      }
      const next = result.data.changes;
      if (last !== undefined) {
        for (const area of changedAreas(last, next)) void reloaders[area]();
      }
      last = next;
    };
    const stop = () => {
      epoch++;
      clearInterval(timer);
    };
    const start = () => {
      stop();
      void poll();
      timer = setInterval(() => void poll(), POLL_MS);
    };

    start();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") start();
      else stop();
    });
    return () => {
      stop();
      subscription.remove();
    };
  }, [token, signOut, project, obra, photos, documents]);
}

/** Runs `useLiveUpdates` inside the app's data providers. */
export function LiveUpdates() {
  useLiveUpdates();
  return null;
}
