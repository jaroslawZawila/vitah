import { canEdit } from "@repo/core";
import { forbidden, requireSession } from "@/lib/access";
import { getAssignableClients } from "../../../actions/project-client";
import type { ProjectFlowOptions } from "./draft";
import NewProjectScreen from "./NewProjectScreen";

export default async function NewProjectPage() {
  const ctx = await requireSession();
  // Viewers can't create projects (core refuses too).
  if (!canEdit(ctx.role)) forbidden();
  const canAssignClient = ctx.role === "admin";
  const options: ProjectFlowOptions = {
    canAssignClient,
    clients: canAssignClient ? await getAssignableClients() : [],
  };
  return <NewProjectScreen options={options} />;
}
