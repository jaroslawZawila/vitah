import React, { createContext, use, useMemo } from "react";
import { api, type Project } from "./api";
import { useClientData } from "./use-client-data";

const getProject = (token: string) => api.getProject(token);

type ProjectValue = Omit<ReturnType<typeof useClientData>, "data"> & {
  /** `undefined` until loaded, `null` when none is assigned. */
  project: Project | null | undefined;
};

const ProjectContext = createContext<ProjectValue | null>(null);

/** One copy of the client's project for every screen. */
export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { data, ...state } = useClientData(getProject);
  const project = data?.project;
  const value = useMemo(() => ({ ...state, project }), [state, project]);
  return <ProjectContext value={value}>{children}</ProjectContext>;
}

/** The signed-in client's project. */
export function useProject(): ProjectValue {
  const ctx = use(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
