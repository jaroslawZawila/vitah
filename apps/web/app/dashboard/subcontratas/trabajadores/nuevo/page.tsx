import { canEdit } from "@repo/core";
import { forbidden, requireSession } from "@/lib/access";
import { getSubcontractorList } from "../../../../actions/subcontractors";
import WorkerScreen from "../WorkerScreen";

export default async function NewWorkerPage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const [{ empresa = "" }, ctx] = await Promise.all([searchParams, requireSession()]);
  // Viewers can't register workers (core refuses too).
  if (!canEdit(ctx.role)) forbidden();
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
