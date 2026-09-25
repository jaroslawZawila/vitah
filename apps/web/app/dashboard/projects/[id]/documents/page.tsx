import { redirect } from "next/navigation";
import { getProjectDocuments } from "../../../../actions/documents";
import { getProject } from "../../../../actions/projects";
import DocumentsScreen from "./DocumentsScreen";

/** The project's "Documents" tab: PDFs shared with its client. */
export default async function ProjectDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, { documents, canManage }] = await Promise.all([
    getProject(id),
    getProjectDocuments(id),
  ]);

  if (!project) {
    redirect("/dashboard/projects");
  }

  return (
    <DocumentsScreen
      projectId={project.id}
      projectRef={project.ref}
      documents={documents}
      canManage={canManage}
    />
  );
}
