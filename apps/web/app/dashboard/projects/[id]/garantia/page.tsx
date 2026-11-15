import { notFound } from "next/navigation";
import { getProject } from "../../../../actions/projects";
import { getProjectWarranty } from "../../../../actions/warranty";
import WarrantyScreen from "./WarrantyScreen";

/** The project's Garantía tab: the hand-over, the LOE periods and the claims the client sent from the app. */
export default async function ProjectWarrantyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, result] = await Promise.all([getProject(id), getProjectWarranty(id)]);
  if (!result) notFound();
  return <WarrantyScreen projectId={project.id} projectRef={project.ref} warranty={result.warranty} />;
}
