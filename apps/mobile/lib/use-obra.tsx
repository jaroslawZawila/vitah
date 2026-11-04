import React, { createContext, use, useMemo } from "react";
import type { MobileObra } from "@repo/core/contract";
import { api } from "./api";
import { useClientData } from "./use-client-data";
import { useProjectData } from "./use-project";

const getObra = (token: string, projectId: string | null) => api.getObra(token, projectId);

type ObraValue = Omit<ReturnType<typeof useClientData>, "data"> & {
  /** `undefined` until loaded, `null` without a project. */
  obra: MobileObra | null | undefined;
};

const ObraContext = createContext<ObraValue | null>(null);

/** One copy of the obra of the home shown, for the Obra tab, Inicio and the screens pushed from them. */
export function ObraProvider({ children }: { children: React.ReactNode }) {
  const { data, ...state } = useProjectData(getObra);
  const obra = data?.obra;
  const value = useMemo(() => ({ ...state, obra }), [state, obra]);
  return <ObraContext value={value}>{children}</ObraContext>;
}

/** The construction progress and payments of the home shown. */
export function useObra(): ObraValue {
  const ctx = use(ObraContext);
  if (!ctx) throw new Error("useObra must be used within ObraProvider");
  return ctx;
}
