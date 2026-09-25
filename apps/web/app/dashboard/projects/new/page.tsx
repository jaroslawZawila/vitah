import { getSessionContext } from "@repo/auth/context";
import { getAssignableClients } from "../../../actions/project-client";
import type { ProjectFlowOptions } from "./draft";
import NewProjectScreen from "./NewProjectScreen";

export default async function NewProjectPage() {
  const ctx = await getSessionContext();
  const canAssignClient = ctx?.role === "admin";
  const options: ProjectFlowOptions = {
    canAssignClient,
    clients: canAssignClient ? await getAssignableClients() : [],
  };
  return <NewProjectScreen options={options} />;
}
