import { redirect } from "next/navigation";
import { canEdit } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { getAssignableClients } from "../../../actions/project-client";
import type { ProjectFlowOptions } from "./draft";
import NewProjectScreen from "./NewProjectScreen";

export default async function NewProjectPage() {
  const ctx = await getSessionContext();
  // Viewers can't create projects (core refuses too).
  if (!ctx || !canEdit(ctx.role)) redirect("/dashboard/projects");
  const canAssignClient = ctx.role === "admin";
  const options: ProjectFlowOptions = {
    canAssignClient,
    clients: canAssignClient ? await getAssignableClients() : [],
  };
  return <NewProjectScreen options={options} />;
}
