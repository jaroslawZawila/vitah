"use server";

// Thin portal adapters over @repo/core's budget service
// (packages/core/src/budget.ts), behind the project's Budget tab.

import { budgetService as svc } from "@repo/core";
import { mutate, read, type ObraState } from "./run";

type Input = Record<string, unknown>;

/** All revisions and one in full (default: the newest). */
export async function getProjectBudget(projectId: string, revisionId?: string) {
  const result = await read((ctx) => svc.getBudget(ctx, projectId, revisionId));
  return result && { budget: result.data, canManage: result.canManage };
}

export async function createBudgetAction(projectId: string, input: Input): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.createBudget(ctx, projectId, input));
}

export async function createRevisionAction(projectId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.createRevision(ctx, projectId));
}

export async function updateRevisionAction(
  projectId: string,
  revisionId: string,
  input: Input,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.updateRevision(ctx, projectId, revisionId, input));
}

export async function acceptRevisionAction(
  projectId: string,
  revisionId: string,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.acceptRevision(ctx, projectId, revisionId));
}

export async function deleteRevisionAction(
  projectId: string,
  revisionId: string,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.deleteRevision(ctx, projectId, revisionId));
}

export async function addChapterAction(
  projectId: string,
  revisionId: string,
  input: Input,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.addChapter(ctx, projectId, revisionId, input));
}

export async function updateChapterAction(
  projectId: string,
  chapterId: string,
  input: Input,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.updateChapter(ctx, projectId, chapterId, input));
}

export async function deleteChapterAction(
  projectId: string,
  chapterId: string,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.deleteChapter(ctx, projectId, chapterId));
}

export async function addLineAction(
  projectId: string,
  chapterId: string,
  input: Input,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.addLine(ctx, projectId, chapterId, input));
}

export async function updateLineAction(
  projectId: string,
  lineId: string,
  input: Input,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.updateLine(ctx, projectId, lineId, input));
}

export async function deleteLineAction(projectId: string, lineId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.deleteLine(ctx, projectId, lineId));
}
