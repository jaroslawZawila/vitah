import { canEdit } from "@repo/core";
import { requireSession } from "@/lib/access";
import { getProjectList } from "../../actions/projects";
import ProjectsListClient from "./ProjectsListClient";
import { toProjectRows } from "./project-list";

/** Proyectos: every project, filtered by its budget and its obra (`?presupuesto=&obra=&q=`, read by the list). */
export default async function ProjectsPage() {
  const [projects, ctx] = await Promise.all([getProjectList(), requireSession()]);
  return <ProjectsListClient projects={toProjectRows(projects)} canCreate={canEdit(ctx.role)} />;
}
