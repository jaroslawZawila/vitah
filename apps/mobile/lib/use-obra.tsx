import React, { createContext, use, useMemo } from "react";
import type { MobileObra } from "@repo/core/contract";
import { api } from "./api";
import { useClientData } from "./use-client-data";

const getObra = (token: string) => api.getObra(token);

type ObraValue = Omit<ReturnType<typeof useClientData>, "data"> & {
  /** `undefined` until loaded, `null` without a project. */
  obra: MobileObra | null | undefined;
};

const ObraContext = createContext<ObraValue | null>(null);

/** One copy of the client's obra for the Obra tab, Inicio and the screens pushed from them. */
export function ObraProvider({ children }: { children: React.ReactNode }) {
  const { data, ...state } = useClientData(getObra);
  const obra = data?.obra;
  const value = useMemo(() => ({ ...state, obra }), [state, obra]);
  return <ObraContext value={value}>{children}</ObraContext>;
}

/** The signed-in client's construction progress and payments. */
export function useObra(): ObraValue {
  const ctx = use(ObraContext);
  if (!ctx) throw new Error("useObra must be used within ObraProvider");
  return ctx;
}
