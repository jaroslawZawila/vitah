"use client";

// Container for the "Jefe de obra" card: the only part that knows about server
// actions. The view (SiteManagerPicker) takes props only.

import { useActionState } from "react";
import type { ProjectSiteManager } from "@repo/core/contract";
import { setSiteManagerAction } from "../../../../actions/contact";
import SiteManagerPicker from "./SiteManagerPicker";

/** Admins and managers pick who the client's app shows as their site manager. */
export default function SiteManagerCard({ projectId, data }: { projectId: string; data: ProjectSiteManager }) {
  const [state, action, pending] = useActionState(setSiteManagerAction.bind(null, projectId), null);
  return (
    <SiteManagerPicker
      current={data.siteManager}
      options={data.options}
      action={action}
      pending={pending}
      error={state?.error}
      saved={state?.success === true}
    />
  );
}
