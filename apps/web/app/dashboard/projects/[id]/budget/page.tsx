import { redirect } from "next/navigation";
import { getProjectBudget } from "../../../../actions/budget";
import { getProject } from "../../../../actions/projects";
import BudgetScreen from "./BudgetScreen";

/** The project's "Budget" tab; `?revision=<id>` shows an older revision. */
export default async function ProjectBudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ revision?: string }>;
}) {
  const [{ id }, { revision }] = await Promise.all([params, searchParams]);
  const [project, result] = await Promise.all([getProject(id), getProjectBudget(id, revision)]);
  if (!project) redirect("/dashboard/projects");
  if (!result) redirect(`/dashboard/projects/${id}/budget`);

  return (
    <BudgetScreen
      // A new revision starts with fresh open/closed chapters.
      key={result.budget.revision?.id ?? "none"}
      projectId={project.id}
      projectRef={project.ref}
      budget={result.budget}
      canManage={result.canManage}
    />
  );
}
