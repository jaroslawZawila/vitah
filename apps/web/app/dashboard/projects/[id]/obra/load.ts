import { cache } from "react";
import { redirect } from "next/navigation";
import type { ConstructionControl } from "@repo/core/contract";
import { getConstructionControl, getConstructionHeader } from "../../../../actions/construction";
import type { ObraHeader } from "../components/construction/ObraFrame";

// Shared by the Obra pages (server only): every page's header needs the
// project's ref, stage and open issues, which the control has.

/** The project's construction control, once per request; leaves the page when it can't be read. */
export const loadControl = cache(async (projectId: string) => {
  const result = await getConstructionControl(projectId);
  if (!result) redirect("/dashboard/projects");
  return result;
});

/** Just the header and the chapters to pick from: for the pages that don't show the control. */
export const loadHeader = cache(async (projectId: string) => {
  const result = await getConstructionHeader(projectId);
  if (!result) redirect("/dashboard/projects");
  return result.header;
});

export const headerOf = (control: ConstructionControl): ObraHeader => ({
  ref: control.project.ref,
  stage: control.project.stage,
  openIssues: control.issues.length,
});
