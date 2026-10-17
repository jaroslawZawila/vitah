import { redirect } from "next/navigation";
import { getConstructionPhotos } from "../../../../../actions/construction";
import { loadHeader } from "../load";
import PhotosScreen from "./PhotosScreen";

/** Obra › Fotos: the site photos, shared with the client in the app. */
export default async function ObraPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [header, result] = await Promise.all([loadHeader(id), getConstructionPhotos(id)]);
  if (!result) redirect(`/dashboard/projects/${id}/obra`);
  return (
    <PhotosScreen
      projectId={id}
      header={header}
      photos={result.photos}
      chapters={header.chapters}
      today={header.today}
      canManage={result.canManage}
    />
  );
}
