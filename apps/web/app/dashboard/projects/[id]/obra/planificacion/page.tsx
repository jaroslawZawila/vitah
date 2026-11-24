import { notFound } from "next/navigation";
import { getPlanning } from "../../../../../actions/planning";
import { headerOf, loadControl } from "../load";
import PlanningScreen from "./PlanningScreen";

/**
 * Obra › Planificación: the approved plan and where the works are heading (or
 * the way to a first one), with each chapter's real start and finish recorded
 * against it.
 */
export default async function ObraPlanningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, { control, canManage }] = await Promise.all([getPlanning(id), loadControl(id)]);
  if (!result) notFound();
  return <PlanningScreen projectId={id} header={headerOf(control)} control={control} planning={result.planning} canManage={canManage} />;
}
