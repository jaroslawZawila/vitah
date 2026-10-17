import { headerOf, loadControl } from "../load";
import MilestonesScreen from "./MilestonesScreen";

/** Obra › Hitos: the payment milestones as the works reach them. */
export default async function ObraMilestonesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { control } = await loadControl(id);
  return <MilestonesScreen projectId={id} header={headerOf(control)} control={control} />;
}
