import { redirect } from "next/navigation";

/** The old Photos tab: the photos are now under Obra › Fotos. */
export default async function ProjectPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/projects/${id}/obra/fotos`);
}
