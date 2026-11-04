import * as SecureStore from "expo-secure-store";
import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { api, type Project, type Result } from "./api";
import { CHOSEN_KEY, SHOWN_KEY } from "./project-choice";
import { useClientData } from "./use-client-data";

// A client may own several homes (projects); the app shows one at a time,
// doc/mobile-app-design/A-Viviendas.dc.html. It opens on the one the client
// last chose on this phone, else the server's default (the newest not yet
// handed over, listed first).

const listProjects = (token: string) => api.listProjects(token);

/** The chosen home if it is still theirs, else the default (the first); null without any. */
export function pickProject(projects: Project[], chosenId: string | null): Project | null {
  return projects.find((p) => p.id === chosenId) ?? projects[0] ?? null;
}

type Stored = { chosen: string | null; shown: string | null };

type ProjectValue = Omit<ReturnType<typeof useClientData>, "data"> & {
  /** The home shown: `undefined` until loaded, `null` when none is assigned. */
  project: Project | null | undefined;
  /** All of the client's homes, the default one first; `undefined` until loaded. */
  projects: Project[] | undefined;
  /**
   * Whose data the other parts load: the home shown; before the list arrives
   * (or while it can't, offline) the one chosen or last shown on this phone;
   * `undefined` while nothing tells which.
   */
  projectId: string | null | undefined;
  /**
   * Shows another home everywhere in the app, and remembers the choice on the
   * phone unless `remember` is false (a tapped notification shows its home
   * without changing which one the app opens on).
   */
  select: (id: string, remember?: boolean) => void;
};

const ProjectContext = createContext<ProjectValue | null>(null);

/** One list of the client's homes, and the one shown, for every screen. */
export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { data, ...state } = useClientData(listProjects);
  const [stored, setStored] = useState<Stored | undefined>(undefined);

  useEffect(() => {
    const read = (key: string) => SecureStore.getItemAsync(key).catch(() => null);
    void Promise.all([read(CHOSEN_KEY), read(SHOWN_KEY)]).then(([chosen, shown]) =>
      // A home picked meanwhile (e.g. a notification that opened the app) wins.
      setStored((s) => (s ? { ...s, shown: s.shown ?? shown } : { chosen, shown })),
    );
  }, []);

  const projects = data?.projects;
  const project = projects && stored ? pickProject(projects, stored.chosen) : undefined;
  const remembered = stored && (stored.chosen ?? stored.shown);
  const projectId =
    project !== undefined ? (project?.id ?? null) : remembered || (stored && state.error ? null : undefined);

  const shownId = project?.id;
  useEffect(() => {
    if (shownId) void SecureStore.setItemAsync(SHOWN_KEY, shownId).catch(() => {});
  }, [shownId]);

  const select = useCallback((id: string, remember = true) => {
    setStored((s) => ({ shown: s?.shown ?? null, chosen: id }));
    if (remember) void SecureStore.setItemAsync(CHOSEN_KEY, id).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ ...state, project, projects, projectId, select }),
    [state, project, projects, projectId, select],
  );
  return <ProjectContext value={value}>{children}</ProjectContext>;
}

/** The client's homes and the one shown. */
export function useProject(): ProjectValue {
  const ctx = use(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}

/**
 * `useClientData` for the home shown: waits until it is known, and drops what
 * it loaded for another home when the client switches. Keep `fetch` stable
 * (a module-level function).
 */
export function useProjectData<T>(fetch: (token: string, projectId: string | null) => Promise<Result<T>>) {
  const { projectId } = useProject();
  const load = useMemo(
    () => (projectId === undefined ? null : (token: string) => fetch(token, projectId)),
    [fetch, projectId],
  );
  return useClientData(load);
}
