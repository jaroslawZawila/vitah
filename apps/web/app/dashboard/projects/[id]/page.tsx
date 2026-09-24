import { redirect } from "next/navigation";
import { auth } from "../../../../auth";
import { getProject } from "../../../actions/projects";
import ProjectDetailClient from "./ProjectDetailClient";

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

  return (
    <ProjectDetailClient
      project={project}
      canManageClient={session?.user?.role === "admin"}
    />
  );
}
