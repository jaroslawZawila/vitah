import { redirect } from "next/navigation";
import { getProjectObra } from "../../../../actions/obra";
import { getProject } from "../../../../actions/projects";
import HitosScreen from "./HitosScreen";

/** The project's "Payments" tab: the payment hitos H0–H9. */
export default async function ProjectPaymentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, result] = await Promise.all([getProject(id), getProjectObra(id)]);
  if (!project || !result) redirect("/dashboard/projects");

  return (
    <HitosScreen
      projectId={project.id}
      projectRef={project.ref}
      obra={result.obra}
      canManage={result.canManage}
    />
  );
}
