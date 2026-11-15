"use server";

// Thin portal adapters over @repo/core's budget services (packages/core/src/
// budget*.ts), behind the project's Budget tab.

import {
  budgetGenerationsService as generations,
  budgetIssueService as issue,
  budgetOptionsService as options,
  budgetService as svc,
  searchPriceBase,
  type BudgetChapterChangesInput,
  type BudgetGenerationInput,
  type BudgetLineChangesInput,
  type BudgetOptionChangesInput,
  type BudgetRevisionChangesInput,
  type IssueRevisionInput,
  type NewBudgetLineInput,
  type NewBudgetOptionInput,
  type OptionFromLineInput,
  type RejectRevisionInput,
} from "@repo/core";
import { requireSession } from "../../lib/access";
import { cancelBudgetGeneration, startBudgetGeneration } from "../../lib/budget-generation";
import { mutate, read, type ObraState } from "./run";

/**
 * All revisions, one in full (default: the newest) and the newest AI run.
 * Asked for a revision that isn't there (a stale `?revision=` link: the draft
 * was discarded, the id is another project's) it answers null, for the page
 * to show the newest instead; a project that isn't there is "No encontrado".
 */
export async function getProjectBudget(projectId: string, revisionId?: string) {
  const result = await read((ctx) => svc.getBudget(ctx, projectId, revisionId), { optional: Boolean(revisionId) });
  return result && { budget: result.data, canManage: result.canManage };
}

/** The AI run's progress, for the portal to poll while it runs. */
export async function getGenerationAction(projectId: string, generationId: string) {
  // Polled from the open page: a run that is gone just stops being followed.
  const result = await read((ctx) => generations.getGeneration(ctx, projectId, generationId), { optional: true });
  return result?.data ?? null;
}

/** Price base entries for the line picker (any staff member may search; signed out, the login page). */
export async function searchPriceBaseAction(query: string, chapter?: string) {
  await requireSession();
  return searchPriceBase(query, { chapter, limit: 12 });
}

/** Starts the AI over the project's budget documents (a durable workflow). */
export async function startGenerationAction(projectId: string, input: BudgetGenerationInput): Promise<ObraState> {
  return mutate(projectId, (ctx) => startBudgetGeneration(ctx, projectId, input));
}

export async function cancelGenerationAction(projectId: string, generationId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => cancelBudgetGeneration(ctx, projectId, generationId));
}

export async function createRevisionAction(projectId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.createRevision(ctx, projectId));
}

export async function updateRevisionAction(projectId: string, revisionId: string, input: BudgetRevisionChangesInput): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.updateRevision(ctx, projectId, revisionId, input));
}

/** "Usar los datos del proyecto": the draft's cover takes the project's client and address. */
export async function takeProjectDataAction(projectId: string, revisionId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.takeProjectData(ctx, projectId, revisionId));
}

export async function deleteRevisionAction(projectId: string, revisionId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.deleteRevision(ctx, projectId, revisionId));
}

export async function issueRevisionAction(projectId: string, revisionId: string, input: IssueRevisionInput): Promise<ObraState> {
  return mutate(projectId, (ctx) => issue.issueRevision(ctx, projectId, revisionId, input));
}

/**
 * The acceptance dialog's form: acceptedOn, acceptedBy, chosenOptionIds
 * (repeated) and, optionally, the signed copy (`signed`, a PDF). Issued
 * revisions only: core refuses a draft (`not_issued`).
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

export async function rejectRevisionAction(projectId: string, revisionId: string, input: RejectRevisionInput = {}): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.rejectRevision(ctx, projectId, revisionId, input));
}

export async function updateChapterAction(projectId: string, chapterId: string, input: BudgetChapterChangesInput): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.updateChapter(ctx, projectId, chapterId, input));
}

export async function addLineAction(projectId: string, chapterId: string, input: NewBudgetLineInput): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.addLine(ctx, projectId, chapterId, input));
}

export async function updateLineAction(projectId: string, lineId: string, input: BudgetLineChangesInput): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.updateLine(ctx, projectId, lineId, input));
}

export async function deleteLineAction(projectId: string, lineId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.deleteLine(ctx, projectId, lineId));
}

export async function addOptionAction(projectId: string, revisionId: string, input: NewBudgetOptionInput): Promise<ObraState> {
  return mutate(projectId, (ctx) => options.addOption(ctx, projectId, revisionId, input));
}

export async function updateOptionAction(projectId: string, optionId: string, input: BudgetOptionChangesInput): Promise<ObraState> {
  return mutate(projectId, (ctx) => options.updateOption(ctx, projectId, optionId, input));
}

export async function deleteOptionAction(projectId: string, optionId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => options.deleteOption(ctx, projectId, optionId));
}

export async function optionFromLineAction(projectId: string, lineId: string, input: OptionFromLineInput): Promise<ObraState> {
  return mutate(projectId, (ctx) => options.optionFromLine(ctx, projectId, lineId, input));
}
