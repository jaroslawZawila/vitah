import { redirect } from "next/navigation";
import { auth } from "../../../../auth";
import { getProjectDocuments } from "../../../actions/documents";
import { getAssignableClients } from "../../../actions/project-client";
import { getProject } from "../../../actions/projects";
import ProjectDetailClient from "./ProjectDetailClient";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, session, { documents, canManage }] = await Promise.all([
    getProject(id),
    auth(),
    getProjectDocuments(id),
  ]);

  if (!project) {
    redirect("/dashboard/projects");
  }

  const canManageClient = session?.user?.role === "admin";
  // Only needed to pick a client, i.e. when the project has none.
  const assignableClients =
    canManageClient && !project.client ? await getAssignableClients() : [];

  return (
    <ProjectDetailClient
      project={project}
      canManageClient={canManageClient}
      assignableClients={assignableClients}
      documents={documents}
      canManageDocuments={canManage}
    />
  );
}
