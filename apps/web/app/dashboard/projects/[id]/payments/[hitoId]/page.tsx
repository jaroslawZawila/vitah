import { notFound } from "next/navigation";
import { todayInSpain } from "@repo/core/obra-calc";
import { getProjectHito } from "../../../../../actions/obra";
import { getProject } from "../../../../../actions/projects";
import HitoScreen from "./HitoScreen";

/** A payment hito: its acta, invoice and payment, and their history. A hito that isn't there is "No encontrado". */
export default async function ProjectHitoPage({
  params,
}: {
  params: Promise<{ id: string; hitoId: string }>;
}) {
  const { id, hitoId } = await params;
  const [project, result] = await Promise.all([getProject(id), getProjectHito(id, hitoId)]);
  if (!result) notFound();
  const { events, ...hito } = result.hito;

  return (
    <HitoScreen
      projectId={project.id}
      projectRef={project.ref}
      hito={hito}
      events={events}
      today={todayInSpain()}
      photos={result.photos}
      canManage={result.canManage}
    />
  );
}
