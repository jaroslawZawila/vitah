import { headerOf, loadControl } from "./load";
import SummaryScreen from "./SummaryScreen";

/** The project's "Obra" tab, Resumen: the works at a glance. */
export default async function ObraSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { control, canManage } = await loadControl(id);
  return <SummaryScreen projectId={id} header={headerOf(control)} control={control} canManage={canManage} />;
}
