import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type { Result } from "./api";
import { useAuth } from "./auth";

type State<T> = {
  /** `undefined` until the first successful load. */
  data: T | undefined;
  /** The last load failed. Previously loaded data is kept. */
  error: boolean;
  refreshing: boolean;
};

/**
 * Loads data for the signed-in client with `fetch` (keep it stable, e.g. a
 * module-level function), and again quietly whenever the app returns to the
 * foreground. Signs out when the server rejects the session (e.g. access was
 * revoked in the portal). `reload` loads again without showing a refresh, e.g.
 * when the server says the data changed.
 */
export function useClientData<T>(fetch: (token: string) => Promise<Result<T>>) {
  const { token, signOut } = useAuth();
  const [state, setState] = useState<State<T>>({
    data: undefined,
    error: false,
    refreshing: false,
  });

  // Loads can overlap (a pull-to-refresh and a reload): only the latest one's answer counts.
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!token) return;
    const request = ++latest.current;
    const result = await fetch(token);
    if (request !== latest.current) return;
    if (result.ok) {
      setState({ data: result.data, error: false, refreshing: false });
    } else if (result.error === "unauthorized") {
      await signOut();
    } else {
      setState((s) => ({ ...s, error: true, refreshing: false }));
    }
  }, [fetch, token, signOut]);

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
