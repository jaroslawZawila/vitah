import { redirect } from "next/navigation";
import { getConstructionChapter } from "../../../../../../actions/construction";
import { loadControl } from "../../load";
import ChapterScreen from "./ChapterScreen";

/** A chapter of the contract under Obra › Avance (its code URL-encoded). */
export default async function ObraChapterPage({ params }: { params: Promise<{ id: string; code: string }> }) {
  const { id, code } = await params;
  const [{ control }, result] = await Promise.all([loadControl(id), getConstructionChapter(id, decodeURIComponent(code))]);
  if (!result) redirect(`/dashboard/projects/${id}/obra/avance`);
  return <ChapterScreen projectId={id} control={control} detail={result.detail} canManage={result.canManage} />;
}
