import { canEdit } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { getProjects } from "../../actions/projects";
import ProjectsListClient from "./ProjectsListClient";

export default async function ProjectsPage() {
  const [projects, ctx] = await Promise.all([getProjects(), getSessionContext()]);
  return (
    <ProjectsListClient
      projects={projects}
      canCreate={!!ctx && canEdit(ctx.role)}
    />
  );
}
