import { redirect } from "next/navigation";
import { getProjectPhotos } from "../../../../actions/photos";
import { getProject } from "../../../../actions/projects";
import PhotosScreen from "./PhotosScreen";

/** The project's "Photos" tab: site photos shared with its client. */
export default async function ProjectPhotosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, { photos, canManage }] = await Promise.all([
    getProject(id),
    getProjectPhotos(id),
  ]);

  if (!project) {
    redirect("/dashboard/projects");
  }

  return (
    <PhotosScreen
      projectId={project.id}
      projectRef={project.ref}
      photos={photos}
      canManage={canManage}
    />
  );
}
