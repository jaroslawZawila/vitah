import { canEdit } from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { getProjectList } from "../../actions/projects";
import ProjectsListClient from "./ProjectsListClient";
import { toProjectRows } from "./project-list";

/** Proyectos: every project, filtered by its budget and its obra (`?presupuesto=&obra=&q=`, read by the list). */
export default async function ProjectsPage() {
  const [projects, ctx] = await Promise.all([getProjectList(), getSessionContext()]);
  return <ProjectsListClient projects={toProjectRows(projects)} canCreate={!!ctx && canEdit(ctx.role)} />;
}
