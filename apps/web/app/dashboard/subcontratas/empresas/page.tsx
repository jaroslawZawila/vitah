import { notFound } from "next/navigation";
import { canEdit } from "@repo/core";
import { requireSession } from "@/lib/access";
import { getSubcontractorsOverview } from "../../../actions/subcontractors";
import CompaniesScreen from "./CompaniesScreen";

/** Subcontratas › Empresas: KPIs, what needs attention and the register of companies. */
export default async function CompaniesPage() {
  const [overview, ctx] = await Promise.all([getSubcontractorsOverview(), requireSession()]);
  if (!overview) notFound();
  return <CompaniesScreen overview={overview} canManage={canEdit(ctx.role)} />;
}
