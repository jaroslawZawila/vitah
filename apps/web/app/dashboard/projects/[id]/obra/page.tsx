import { redirect } from "next/navigation";
import { getProjectObra } from "../../../../actions/obra";
import { getProject } from "../../../../actions/projects";
import ObraScreen from "./ObraScreen";

/** The project's "Obra" tab: the construction process, progress and chapters. */
export default async function ProjectObraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, result] = await Promise.all([getProject(id), getProjectObra(id)]);
  if (!project || !result) redirect("/dashboard/projects");

  return (
    <ObraScreen
      projectId={project.id}
      projectRef={project.ref}
      obra={result.obra}
      canManage={result.canManage}
    />
  );
}
