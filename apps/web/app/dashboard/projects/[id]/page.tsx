import { redirect } from "next/navigation";
import { canEdit } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { getProjectObra } from "../../../actions/obra";
import { getAssignableClients } from "../../../actions/project-client";
import { getProject } from "../../../actions/projects";
import ClientAccessCard from "./components/ClientAccessCard";
import ProjectHeader from "./components/ProjectHeader";
import ProjectStages from "./ProjectStages";

/** The project's "General" tab: its details, its stage in the process and the client's app access. */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, ctx, obra] = await Promise.all([getProject(id), getSessionContext(), getProjectObra(id)]);

  if (!project) {
    redirect("/dashboard/projects");
  }

  const isAdmin = ctx?.role === "admin";
  // Only needed to pick a client, i.e. when the project has none.
  const assignableClients =
    isAdmin && !project.client ? await getAssignableClients() : [];

  return (
    <>
      <ProjectHeader
        project={project}
        canEdit={!!ctx && canEdit(ctx.role)}
        canDelete={isAdmin}
      />
      {obra && <ProjectStages projectId={project.id} obra={obra.obra} canManage={obra.canManage} />}
      {isAdmin && (
        <ClientAccessCard
          projectId={project.id}
          client={project.client}
          assignableClients={assignableClients}
        />
      )}
    </>
  );
}
