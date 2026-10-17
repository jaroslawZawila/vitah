import { redirect } from "next/navigation";
import { getConstructionIssues } from "../../../../../actions/construction";
import { loadHeader } from "../load";
import IssuesScreen from "./IssuesScreen";

/** Obra › Incidencias: the issues and changes log of the works. */
export default async function ObraIssuesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [header, result] = await Promise.all([loadHeader(id), getConstructionIssues(id)]);
  if (!result) redirect(`/dashboard/projects/${id}/obra`);
  return (
    <IssuesScreen
      projectId={id}
      header={header}
      issues={result.issues}
      chapters={header.chapters}
      today={header.today}
      canManage={result.canManage}
    />
  );
}
