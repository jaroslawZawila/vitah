import { redirect } from "next/navigation";
import { getProjectDocuments } from "../../../../../actions/documents";
import { getProjectObra } from "../../../../../actions/obra";
import { getProject } from "../../../../../actions/projects";
import { getProjectBudget } from "../../../../../actions/budget";
import BudgetScreen from "../BudgetScreen";
import BudgetStartScreen from "../BudgetStartScreen";
import type { BudgetTab } from "../../components/budget/links";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ revision?: string; chapter?: string }>;
};

/**
 * Loads what every Budget page needs and shows `tab`; before there is a
 * budget, the start (documents and the AI). `?revision=<id>` shows an older one.
 */
export async function budgetPage({ params, searchParams }: PageProps, tab: BudgetTab) {
  const [{ id }, { revision, chapter }] = await Promise.all([params, searchParams]);
  // The hitos: the Conditions tab's plan, and the Accept dialog's first payment.
  const hitos = async () => (await getProjectObra(id))?.obra.hitos ?? [];
  const [project, result, { documents }, conditionsHitos] = await Promise.all([
    getProject(id),
    getProjectBudget(id, revision),
    getProjectDocuments(id),
    tab === "conditions" ? hitos() : null,
  ]);
  if (!project) redirect("/dashboard/projects");
  if (!result) redirect(`/dashboard/projects/${id}/budget`);
  const inputs = documents.filter((d) => d.budgetInput);
  const { budget, canManage } = result;

  if (!budget.revision) {
    if (tab !== "summary") redirect(`/dashboard/projects/${id}/budget`);
    return (
      <BudgetStartScreen
        // A new run, or a run that moved on, starts the screen afresh.
        key={`${budget.generation?.id}:${budget.generation?.status}`}
        projectId={project.id}
        projectRef={project.ref}
        generation={budget.generation}
        canManage={canManage}
        inputs={inputs}
        documents={documents}
      />
    );
  }
  const planHitos = conditionsHitos ?? (budget.revision.status === "issued" ? await hitos() : []);
  return (
    <BudgetScreen
      // Another revision starts with fresh dialogs and fields.
      key={budget.revision.id}
      projectId={project.id}
      projectRef={project.ref}
      site={budget.revision.texts.cover.site || project.address}
      clientName={project.client?.name ?? project.client?.email ?? null}
      budget={{ ...budget, revision: budget.revision }}
      canManage={canManage}
      tab={tab}
      chapterCode={chapter}
      inputs={inputs}
      hitos={planHitos}
    />
  );
}

/** The project's Budget tab: the summary (or, before a budget, its start). */
export default function ProjectBudgetPage(props: PageProps) {
  return budgetPage(props, "summary");
}
