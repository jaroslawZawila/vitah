import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type { Result } from "./api";
import { useAuth } from "./auth";
import { offlineSession, readOffline, writeOffline } from "./offline-cache";

type State<T> = {
  /** `undefined` until the first successful load. */
  data: T | undefined;
  /** The last load failed. Previously loaded data is kept. */
  error: boolean;
  refreshing: boolean;
  /** When `data` was loaded (from the phone's copy: when that was saved); `undefined` without data. */
  updatedAt?: string;
  /** The last load failed for lack of a connection (a note, with `updatedAt`, tells the client). */
  offline?: boolean;
};

const INITIAL: State<never> = {
  data: undefined,
  error: false,
  refreshing: false,
};

/** Opt-in persistence: keep the last answer on the phone, per client and per home, and show it at once on open. */
export type OfflineOptions<T> = {
  /** Which part of the app this is (`obra`, `photos`…), and the home it is for (none: not per home). */
  cache: { name: string; projectId?: string | null };
  /** Called with every answer that came from the server (never with the stored copy). */
  onFresh?: (data: T) => void;
};

/**
 * Loads data for the signed-in client with `fetch` (keep it stable, e.g. a
 * module-level function or a memo), and again quietly whenever the app
 * returns to the foreground. Signs out when the server rejects the session
 * (e.g. access was revoked in the portal). `reload` loads again without
 * showing a refresh, e.g. when the server says the data changed. A null
 * `fetch` waits (e.g. until the home to show is known); another `fetch` (e.g.
 * for another home) drops what the last one loaded. With `options` the last
 * answer is also kept on the phone (`lib/offline-cache.ts`): it shows at once
 * on open, and stays while the network fails (`offline`, `updatedAt`).
 */
export function useClientData<T>(
  fetch: ((token: string) => Promise<Result<T>>) | null,
  options?: OfflineOptions<T>,
) {
  const { token, user, signOut } = useAuth();
  const userId = user?.id;
  const cacheName = options?.cache.name;
  const cacheHome = options?.cache.projectId;
  const onFresh = useRef(options?.onFresh);
  onFresh.current = options?.onFresh;
  const key = useMemo(
    () => (userId && cacheName ? { userId, name: cacheName, projectId: cacheHome } : null),
    [userId, cacheName, cacheHome],
  );
  const [state, setState] = useState<State<T>>(INITIAL);

  // Loads can overlap (a pull-to-refresh and a reload): only the latest one's answer counts.
  const latest = useRef(0);

  // Another home's data must never show under this one.
  const [loadedBy, setLoadedBy] = useState({ fetch, key });
  if (loadedBy.fetch !== fetch || loadedBy.key !== key) {
    setLoadedBy({ fetch, key });
    setState(INITIAL);
  }

  const load = useCallback(async () => {
    if (!token || !fetch) return;
    const request = ++latest.current;
    const started = offlineSession();
    const result = await fetch(token);
    if (request !== latest.current) return;
    if (result.ok) {
      if (key) writeOffline(key, result.data, started);
      onFresh.current?.(result.data);
      const updatedAt = new Date().toISOString();
      setState({ data: result.data, error: false, refreshing: false, updatedAt, offline: false });
    } else if (result.error === "unauthorized") {
      await signOut();
    } else {
      const offline = result.error === "network_error" || result.error === "timeout";
      setState((s) => ({ ...s, error: true, refreshing: false, offline }));
    }
  }, [fetch, token, signOut, key]);

  // The copy kept on the phone shows until the first answer; an answer that
  // came first wins. It is read per client and per home, so no other's shows.
  useEffect(() => {
    if (!key || !fetch) return;
    let stale = false;
    void readOffline<T>(key).then((stored) => {
      if (stale || !stored) return;
      setState((s) => (s.data === undefined ? { ...s, data: stored.data, updatedAt: stored.savedAt } : s));
    });
    return () => {
      stale = true;
    };
  }, [key, fetch]);

  useEffect(() => {
    void load();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") void load();
    });
    return () => subscription.remove();
  }, [load]);

  const refresh = useCallback(() => {
    setState((s) => ({ ...s, refreshing: true }));
    void load();
  }, [load]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, error: false }));
    void load();
  }, [load]);

  return useMemo(() => ({ ...state, refresh, retry, reload: load }), [state, refresh, retry, load]);
}
