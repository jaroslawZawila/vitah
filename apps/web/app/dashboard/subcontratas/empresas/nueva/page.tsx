import { redirect } from "next/navigation";
import { canEdit } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { getSubcontractorProjects } from "../../../../actions/subcontractors";
import NewCompanyScreen from "./NewCompanyScreen";

export default async function NewCompanyPage() {
  const ctx = await getSessionContext();
  // Viewers can't register companies (core refuses too).
  if (!ctx || !canEdit(ctx.role)) redirect("/dashboard/subcontratas/empresas");
  const projects = (await getSubcontractorProjects()) ?? [];
  return <NewCompanyScreen options={{ projects }} />;
}
