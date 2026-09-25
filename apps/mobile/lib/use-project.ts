import { api } from "./api";
import { useClientData } from "./use-client-data";

const getProject = (token: string) => api.getProject(token);

/**
 * The signed-in client's project: `undefined` until loaded, `null` when none
 * is assigned.
 */
export function useProject() {
  const { data, ...state } = useClientData(getProject);
  return { ...state, project: data?.project };
}
