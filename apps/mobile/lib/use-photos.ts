import { api } from "./api";
import { useClientData } from "./use-client-data";

const listPhotos = (token: string) => api.listPhotos(token);

/** Site photos of the signed-in client's project, newest first; `undefined` until loaded. */
export function usePhotos() {
  const { data, ...state } = useClientData(listPhotos);
  return { ...state, photos: data?.photos };
}
