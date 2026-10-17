import { headerOf, loadControl } from "../load";
import AvanceScreen from "./AvanceScreen";

/** Obra › Avance: each chapter's actual start and finish against its plan. */
export default async function ObraProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { control, canManage } = await loadControl(id);
  return <AvanceScreen projectId={id} header={headerOf(control)} control={control} canManage={canManage} />;
}
