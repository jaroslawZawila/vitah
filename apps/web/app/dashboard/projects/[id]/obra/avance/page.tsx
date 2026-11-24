import { redirect } from "next/navigation";
import type { SearchParams } from "../../../../../../lib/list-query";
import { planningHref } from "../../components/planning/links";

/** The old Obra › Avance: merged into Planificación, where its chapters and their start and finish now are. */
export default async function ObraProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(name, one);
  }
  const text = search.toString();
  redirect(text ? `${planningHref(id)}?${text}` : planningHref(id));
}
