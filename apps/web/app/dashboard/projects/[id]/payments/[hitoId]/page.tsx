import { redirect } from "next/navigation";
import { getProjectHito } from "../../../../../actions/obra";
import { getProject } from "../../../../../actions/projects";
import HitoScreen from "./HitoScreen";

/** A payment hito: its acta, invoice and payment. */
export default async function ProjectHitoPage({
  params,
}: {
  params: Promise<{ id: string; hitoId: string }>;
}) {
  const { id, hitoId } = await params;
  const [project, result] = await Promise.all([getProject(id), getProjectHito(id, hitoId)]);
  if (!project) redirect("/dashboard/projects");
  if (!result) redirect(`/dashboard/projects/${id}/payments`);

  return (
    <HitoScreen
      projectId={project.id}
      projectRef={project.ref}
      hito={result.hito}
      photos={result.photos}
      canManage={result.canManage}
    />
  );
}
