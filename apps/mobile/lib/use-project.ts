import { useCallback, useEffect, useState } from "react";
import { api, type Project } from "./api";
import { useAuth } from "./auth";

type ProjectState = {
  /** `undefined` until the first successful load; `null` when none is assigned. */
  project: Project | null | undefined;
  /** The last load failed. Previously loaded data is kept. */
  error: boolean;
  refreshing: boolean;
};

/**
 * Loads the signed-in client's project. Signs out when the server rejects the
 * session (e.g. access was revoked in the portal).
 */
export function useProject() {
  const { token, signOut } = useAuth();
  const [state, setState] = useState<ProjectState>({
    project: undefined,
    error: false,
    refreshing: false,
  });

  const load = useCallback(async () => {
    if (!token) return;
    const result = await api.getProject(token);
    if (result.ok) {
      setState({ project: result.data.project, error: false, refreshing: false });
    } else if (result.error === "unauthorized") {
      await signOut();
    } else {
      setState((s) => ({ ...s, error: true, refreshing: false }));
    }
  }, [token, signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    setState((s) => ({ ...s, refreshing: true }));
    void load();
  }, [load]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, error: false }));
    void load();
  }, [load]);

  return { ...state, refresh, retry };
}
