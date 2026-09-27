import { redirect } from "next/navigation";
import { getProjectChapter } from "../../../../../actions/obra";
import { getProject } from "../../../../../actions/projects";
import ChapterScreen from "./ChapterScreen";

/** A chapter of the accepted budget: record the progress of its lines. */
export default async function ProjectChapterPage({
  params,
}: {
  params: Promise<{ id: string; code: string }>;
}) {
  const { id, code } = await params;
  const [project, result] = await Promise.all([
    getProject(id),
    getProjectChapter(id, decodeURIComponent(code)),
  ]);
  if (!project) redirect("/dashboard/projects");
  if (!result) redirect(`/dashboard/projects/${id}/obra`);

  return (
    <ChapterScreen
      projectId={project.id}
      projectRef={project.ref}
      chapter={result.chapter}
      hito={result.hito}
      photos={result.photos}
      canManage={result.canManage}
    />
  );
}
