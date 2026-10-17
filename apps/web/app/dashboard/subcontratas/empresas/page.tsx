import { redirect } from "next/navigation";
import { canEdit } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { getSubcontractorsOverview } from "../../../actions/subcontractors";
import CompaniesScreen from "./CompaniesScreen";

/** Subcontratas › Empresas: KPIs, what needs attention and the register of companies. */
export default async function CompaniesPage() {
  const [overview, ctx] = await Promise.all([getSubcontractorsOverview(), getSessionContext()]);
  if (!overview || !ctx) redirect("/dashboard");
  return <CompaniesScreen overview={overview} canManage={canEdit(ctx.role)} />;
}
