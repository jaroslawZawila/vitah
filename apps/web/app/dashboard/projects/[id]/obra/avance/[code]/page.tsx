import { notFound } from "next/navigation";
import { getConstructionChapter } from "../../../../../../actions/construction";
import { loadControl } from "../../load";
import ChapterScreen from "./ChapterScreen";

/** A chapter of the contract, under Obra › Planificación at its old Avance address (its code URL-encoded); a code the contract doesn't have is "No encontrado". */
export default async function ObraChapterPage({ params }: { params: Promise<{ id: string; code: string }> }) {
  const { id, code } = await params;
  const [{ control }, result] = await Promise.all([loadControl(id), getConstructionChapter(id, decodeURIComponent(code))]);
  if (!result) notFound();
  return <ChapterScreen projectId={id} control={control} detail={result.detail} canManage={result.canManage} />;
}
