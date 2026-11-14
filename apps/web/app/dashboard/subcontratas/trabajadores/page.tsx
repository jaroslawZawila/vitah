import { canEdit } from "@repo/core";
import { requireSession } from "@/lib/access";
import { getCompanyOptions, getSubcontractorProjects, getWorkers } from "../../../actions/subcontractors";
import WorkersScreen from "./WorkersScreen";

export default async function WorkersPage({ searchParams }: { searchParams: Promise<{ obra?: string }> }) {
  const { obra = "" } = await searchParams;
  const [ctx, workers, projects, companies] = await Promise.all([
    requireSession(),
    getWorkers(obra || null),
    getSubcontractorProjects(),
    getCompanyOptions(),
  ]);
  return (
    <WorkersScreen
      workers={workers ?? []}
      projects={projects ?? []}
      companies={companies ?? []}
      projectId={obra}
      canManage={canEdit(ctx.role)}
    />
  );
}
