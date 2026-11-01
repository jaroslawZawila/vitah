"use server";

// Thin portal adapters over @repo/core's budget services (packages/core/src/
// budget*.ts), behind the project's Budget tab.

import {
  budgetGenerationsService as generations,
  budgetIssueService as issue,
  budgetOptionsService as options,
  budgetOverviewService as overview,
  budgetService as svc,
  searchPriceBase,
} from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { cancelBudgetGeneration, startBudgetGeneration } from "../../lib/budget-generation";
import { mutate, read, type ObraState } from "./run";

type Input = Record<string, unknown>;

/** All revisions, one in full (default: the newest) and the newest AI run. */
export async function getProjectBudget(projectId: string, revisionId?: string) {
  const result = await read((ctx) => svc.getBudget(ctx, projectId, revisionId));
  return result && { budget: result.data, canManage: result.canManage };
}

/** Every obra's newest budget (Proyectos › Presupuestos, and the obras beside a budget); null when signed out. */
export async function getBudgetsOverview() {
  return (await read((ctx) => overview.listBudgets(ctx)))?.data ?? null;
}

/** The AI run's progress, for the portal to poll while it runs. */
export async function getGenerationAction(projectId: string, generationId: string) {
  const result = await read((ctx) => generations.getGeneration(ctx, projectId, generationId));
  return result?.data ?? null;
}

/** Price base entries for the line picker (any staff member may search). */
export async function searchPriceBaseAction(query: string, chapter?: string) {
  if (!(await getSessionContext())) return [];
  return searchPriceBase(query, { chapter, limit: 12 });
}

/** Starts the AI over the project's budget documents (a durable workflow). */
export async function startGenerationAction(projectId: string, input: Input): Promise<ObraState> {
  return mutate(projectId, (ctx) => startBudgetGeneration(ctx, projectId, input));
}

export async function cancelGenerationAction(projectId: string, generationId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => cancelBudgetGeneration(ctx, projectId, generationId));
}

export async function createRevisionAction(projectId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.createRevision(ctx, projectId));
}

export async function updateRevisionAction(projectId: string, revisionId: string, input: Input): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.updateRevision(ctx, projectId, revisionId, input));
}

export async function deleteRevisionAction(projectId: string, revisionId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.deleteRevision(ctx, projectId, revisionId));
}

export async function issueRevisionAction(projectId: string, revisionId: string, input: Input): Promise<ObraState> {
  return mutate(projectId, (ctx) => issue.issueRevision(ctx, projectId, revisionId, input));
}

/**
 * The acceptance dialog's form: acceptedOn, acceptedBy, chosenOptionIds
 * (repeated) and, optionally, the signed copy (`signed`, a PDF).
 */
export async function acceptRevisionAction(projectId: string, revisionId: string, form: FormData): Promise<ObraState> {
  const signed = form.get("signed");
  const input = {
    acceptedOn: form.get("acceptedOn") ?? undefined,
    acceptedBy: form.get("acceptedBy") ?? undefined,
    chosenOptionIds: form.getAll("chosenOptionIds"),
    signed: signed instanceof Blob && signed.size > 0 ? signed : undefined,
  };
  return mutate(projectId, (ctx) => svc.acceptRevision(ctx, projectId, revisionId, input));
}

export async function rejectRevisionAction(projectId: string, revisionId: string, input: Input = {}): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.rejectRevision(ctx, projectId, revisionId, input));
}

export async function updateChapterAction(projectId: string, chapterId: string, input: Input): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.updateChapter(ctx, projectId, chapterId, input));
}

export async function addLineAction(projectId: string, chapterId: string, input: Input): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.addLine(ctx, projectId, chapterId, input));
}

export async function updateLineAction(projectId: string, lineId: string, input: Input): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.updateLine(ctx, projectId, lineId, input));
}

export async function deleteLineAction(projectId: string, lineId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.deleteLine(ctx, projectId, lineId));
}

export async function addOptionAction(projectId: string, revisionId: string, input: Input): Promise<ObraState> {
  return mutate(projectId, (ctx) => options.addOption(ctx, projectId, revisionId, input));
}

export async function updateOptionAction(projectId: string, optionId: string, input: Input): Promise<ObraState> {
  return mutate(projectId, (ctx) => options.updateOption(ctx, projectId, optionId, input));
}

export async function deleteOptionAction(projectId: string, optionId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => options.deleteOption(ctx, projectId, optionId));
}

export async function optionFromLineAction(projectId: string, lineId: string, input: Input): Promise<ObraState> {
  return mutate(projectId, (ctx) => options.optionFromLine(ctx, projectId, lineId, input));
}
