import { redirect } from "next/navigation";
import { getPlanningVersions } from "../../../../../../actions/planning";
import VersionsScreen from "./VersionsScreen";

/** Obra › Planificación › Versiones: every version of the plan and what each changed. */
export default async function PlanVersionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getPlanningVersions(id);
  if (!data) redirect("/dashboard/projects");
  return <VersionsScreen projectId={id} data={data} />;
}
