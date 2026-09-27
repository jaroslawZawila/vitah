import { redirect } from "next/navigation";
import { canEdit } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { getAssignableClients } from "../../../actions/project-client";
import { getProject } from "../../../actions/projects";
import ClientAccessCard from "./components/ClientAccessCard";
import ProjectHeader from "./components/ProjectHeader";

/** The project's "General" tab: its details and the client's app access. */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, ctx] = await Promise.all([getProject(id), getSessionContext()]);

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
