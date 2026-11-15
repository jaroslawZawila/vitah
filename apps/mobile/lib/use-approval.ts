import { useEffect, useRef } from "react";
import { api } from "./api";
import { useObra } from "./use-obra";
import { useProjectData } from "./use-project";

const getApproval = (token: string, projectId: string | null) => api.getApproval(token, projectId);

/**
 * The change to the contract waiting for the client's answer on the home shown
 * (`approval`: undefined until loaded or when it can't be, null when there is
 * none). A request belongs to the contract, which the obra shows: the server
 * moves the obra's change counter when one is made, answered or closed, so
 * whenever the obra reloads this does too.
 */
export function useApproval() {
  const { data, ...state } = useProjectData(getApproval);
  const { obra } = useObra();
  const { reload } = state;
  // Only a reload of the obra counts: its first load, or another home's, loads this anyway.
  const seen = useRef(obra);
  useEffect(() => {
    const before = seen.current;
    seen.current = obra;
    if (before !== undefined && obra !== undefined && before !== obra) void reload();
  }, [obra, reload]);
  return { ...state, approval: data?.approval };
}
