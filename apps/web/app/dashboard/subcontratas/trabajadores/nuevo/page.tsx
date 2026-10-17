import { redirect } from "next/navigation";
import { canEdit } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { getSubcontractorList } from "../../../../actions/subcontractors";
import WorkerScreen from "../WorkerScreen";

export default async function NewWorkerPage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const [{ empresa = "" }, ctx] = await Promise.all([searchParams, getSessionContext()]);
  // Viewers can't register workers (core refuses too).
  if (!ctx || !canEdit(ctx.role)) redirect("/dashboard/subcontratas/trabajadores");
  // A material supplier has no workers (core refuses too).
  const companies = ((await getSubcontractorList()) ?? [])
    .filter((c) => !c.suppliesOnly)
    .map(({ id, legalName, kind, status }) => ({ id, legalName, kind, status }));
  return (
    <WorkerScreen
      worker={null}
      companies={companies}
      initialCompanyId={companies.some((c) => c.id === empresa) ? empresa : ""}
      canManage
    />
  );
}
