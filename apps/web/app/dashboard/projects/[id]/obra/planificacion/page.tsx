import { notFound } from "next/navigation";
import { getPlanning } from "../../../../../actions/planning";
import { loadHeader } from "../load";
import PlanningScreen from "./PlanningScreen";

/** Obra › Planificación: the approved plan and where the works are heading, or the way to a first one. */
export default async function ObraPlanningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, header] = await Promise.all([getPlanning(id), loadHeader(id)]);
  if (!result) notFound();
  return <PlanningScreen projectId={id} header={header} planning={result.planning} canManage={result.canManage} />;
}
