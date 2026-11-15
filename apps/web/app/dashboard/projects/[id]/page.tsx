import { canEdit } from "@repo/core";
import { requireSession } from "@/lib/access";
import { getSiteManager } from "../../../actions/contact";
import { getProjectObra } from "../../../actions/obra";
import { getAssignableClients } from "../../../actions/project-client";
import { getProject } from "../../../actions/projects";
import ClientAccessCard from "./components/ClientAccessCard";
import ProjectHeader from "./components/ProjectHeader";
import SiteManagerCard from "./components/SiteManagerCard";
import ProjectStages from "./ProjectStages";

/**
 * The project's "General" tab: its details, its stage in the process, its site
 * manager (the client's app shows them on Contacto) and the client's app access.
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // A project that isn't there is "No encontrado" (`getProject`); signed out, the login page.
  const [project, ctx, obra] = await Promise.all([getProject(id), requireSession(), getProjectObra(id)]);

  const isAdmin = ctx.role === "admin";
  const editor = canEdit(ctx.role);
  const [assignableClients, siteManager] = await Promise.all([
    // Only needed to pick a client, i.e. when the project has none.
    isAdmin && !project.client ? getAssignableClients() : [],
    // Admins and managers pick the site manager; viewers don't see the card.
    editor ? getSiteManager(id) : null,
  ]);

  return (
    <>
      <ProjectHeader
        project={project}
        canEdit={editor}
        canDelete={isAdmin}
      />
      {obra && <ProjectStages projectId={project.id} obra={obra.obra} canManage={obra.canManage} />}
      {siteManager && <SiteManagerCard projectId={project.id} data={siteManager} />}
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
