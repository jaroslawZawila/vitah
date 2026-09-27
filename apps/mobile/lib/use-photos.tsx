import React, { createContext, use, useMemo } from "react";
import type { MobilePhoto } from "@repo/core/contract";
import { api } from "./api";
import { groupByWeek, type PhotoWeek } from "./photo-weeks";
import { useClientData } from "./use-client-data";

const listPhotos = (token: string) => api.listPhotos(token);

type PhotosValue = Omit<ReturnType<typeof useClientData>, "data"> & {
  /** Newest first; `undefined` until loaded. */
  photos: MobilePhoto[] | undefined;
  /** The photos grouped by week, newest week first. */
  weeks: PhotoWeek[];
  /** Each photo by its id, e.g. to show a phase's or an acta's photos. */
  byId: Map<string, MobilePhoto>;
};

const PhotosContext = createContext<PhotosValue | null>(null);

/** One copy of the client's photos for every screen (Inicio and Fotos). */
export function PhotosProvider({ children }: { children: React.ReactNode }) {
  const { data, ...state } = useClientData(listPhotos);
  const photos = data?.photos;
  const weeks = useMemo(() => groupByWeek(photos ?? []), [photos]);
  const byId = useMemo(() => new Map((photos ?? []).map((p) => [p.id, p])), [photos]);
  const value = useMemo(() => ({ ...state, photos, weeks, byId }), [state, photos, weeks, byId]);
  return <PhotosContext value={value}>{children}</PhotosContext>;
}

/** Site photos of the signed-in client's project. */
export function usePhotos(): PhotosValue {
  const ctx = use(PhotosContext);
  if (!ctx) throw new Error("usePhotos must be used within PhotosProvider");
  return ctx;
}
