import { redirect } from "next/navigation";
import { getPlanningDraft } from "../../../../../../actions/planning";
import { planningHref } from "../../../components/planning/links";
import EditPlanScreen from "./EditPlanScreen";

/** Obra › Planificación › Editar: the open draft; without one, back to Planificación. */
export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getPlanningDraft(id);
  if (!result) redirect(planningHref(id));
  return <EditPlanScreen projectId={id} draft={result.draft} canManage={result.canManage} />;
}
