import { canEdit } from "@repo/core";
import { forbidden, requireSession } from "@/lib/access";
import { getSubcontractorProjects } from "../../../../actions/subcontractors";
import NewCompanyScreen from "./NewCompanyScreen";

export default async function NewCompanyPage() {
  const ctx = await requireSession();
  // Viewers can't register companies (core refuses too).
  if (!canEdit(ctx.role)) forbidden();
  const projects = (await getSubcontractorProjects()) ?? [];
  return <NewCompanyScreen options={{ projects }} />;
}
