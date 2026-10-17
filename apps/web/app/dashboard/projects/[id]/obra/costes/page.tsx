import { redirect } from "next/navigation";
import { getConstructionCosts } from "../../../../../actions/construction";
import { loadHeader } from "../load";
import CostsScreen from "./CostsScreen";

/** Obra › Costes: cost control per budget line. */
export default async function ObraCostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [header, result] = await Promise.all([loadHeader(id), getConstructionCosts(id)]);
  if (!result) redirect(`/dashboard/projects/${id}/obra`);
  return (
    <CostsScreen projectId={id} header={header} costs={result.costs} budgetNumber={header.budgetNumber} />
  );
}
