import { redirect } from "next/navigation";
import { getProjectPurchaseLines, getProjectPurchases } from "../../../../actions/purchasing";
import { loadHeader } from "../obra/load";
import PurchaseLinesScreen from "./PurchaseLinesScreen";
import PurchasesScreen from "./PurchasesScreen";

/**
 * The project's "Compras" tab: by budget line (what is contracted, invoiced
 * and paid of each), or with `?vista=pedidos` its orders of material and
 * subcontracts.
 */
export default async function ProjectPurchasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vista?: string }>;
}) {
  const [{ id }, { vista }] = await Promise.all([params, searchParams]);
  const header = loadHeader(id);
  if (vista === "pedidos") {
    const [{ ref, stage, openIssues, chapters }, result] = await Promise.all([header, getProjectPurchases(id)]);
    if (!result) redirect("/dashboard/projects");
    return (
      <PurchasesScreen
        projectId={id}
        header={{ ref, stage, openIssues }}
        chapters={chapters}
        purchases={result.purchases}
        canManage={result.canManage}
      />
    );
  }
  const [{ ref, stage, openIssues }, result] = await Promise.all([header, getProjectPurchaseLines(id)]);
  if (!result) redirect("/dashboard/projects");
  return <PurchaseLinesScreen projectId={id} header={{ ref, stage, openIssues }} lines={result.lines} canManage={result.canManage} />;
}
