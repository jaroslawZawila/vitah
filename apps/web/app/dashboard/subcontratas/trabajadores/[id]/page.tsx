import { notFound } from "next/navigation";
import { getSubcontractorList, getWorker } from "../../../../actions/subcontractors";
import WorkerScreen from "../WorkerScreen";

export default async function WorkerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [worker, companies] = await Promise.all([getWorker(id), getSubcontractorList()]);
  if (!worker) notFound();
  return (
    <WorkerScreen
      worker={worker}
      companies={(companies ?? [])
        .filter((c) => !c.suppliesOnly)
        .map(({ id, legalName, kind, status }) => ({ id, legalName, kind, status }))}
      canManage={worker.canManage}
    />
  );
}
