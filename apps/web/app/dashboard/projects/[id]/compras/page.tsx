import { redirect } from "next/navigation";
import { getProjectPurchases } from "../../../../actions/purchasing";
import { loadHeader } from "../obra/load";
import PurchasesScreen from "./PurchasesScreen";

/** The project's "Compras" tab: its orders of material and subcontracts. */
export default async function ProjectPurchasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [header, result] = await Promise.all([loadHeader(id), getProjectPurchases(id)]);
  if (!result) redirect("/dashboard/projects");
  return (
    <PurchasesScreen
      projectId={id}
      header={{ ref: header.ref, stage: header.stage, openIssues: header.openIssues }}
      chapters={header.chapters}
      purchases={result.purchases}
      canManage={result.canManage}
    />
  );
}
