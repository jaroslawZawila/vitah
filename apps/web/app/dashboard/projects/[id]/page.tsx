import { redirect } from "next/navigation";
import { auth } from "../../../../auth";
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
  const [project, session] = await Promise.all([getProject(id), auth()]);

  if (!project) {
    redirect("/dashboard/projects");
  }

  const canManageClient = session?.user?.role === "admin";
  // Only needed to pick a client, i.e. when the project has none.
  const assignableClients =
    canManageClient && !project.client ? await getAssignableClients() : [];

  return (
    <>
      <ProjectHeader project={project} />
      {canManageClient && (
        <ClientAccessCard
          projectId={project.id}
          client={project.client}
          assignableClients={assignableClients}
        />
      )}
    </>
  );
}
