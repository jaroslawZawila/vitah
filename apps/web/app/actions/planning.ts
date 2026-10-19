"use server";

// Thin portal adapters over @repo/core's planning (packages/core/src/planning.ts):
// the Obra tab's Planificación, its draft editor and its versions.

import { planningService as svc, type ObraError } from "@repo/core";
import { mutate, read, type ObraState } from "./run";

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function getPlanning(projectId: string) {
  const result = await read((ctx) => svc.getPlanning(ctx, projectId));
  return result && { planning: result.data, canManage: result.canManage };
}

/** The open draft; null when there is none (or it can't be read). */
export async function getPlanningDraft(projectId: string) {
  const result = await read((ctx) => svc.getPlanningDraft(ctx, projectId));
  return result && { draft: result.data, canManage: result.canManage };
}

export async function getPlanningVersions(projectId: string) {
  return (await read((ctx) => svc.getPlanningVersions(ctx, projectId)))?.data ?? null;
}

// ─── Writes ──────────────────────────────────────────────────────────────────
// Each refreshes every tab of the project: Avance, Compras and the Obra
// summary read the approved plan.

/** Opens a draft: a first plan (`from: "template" | "project"`) or a copy of the baseline. */
export async function createPlanningDraftAction(projectId: string, input: Record<string, unknown>): Promise<ObraState> {
  return mutate<ObraError>(projectId, (ctx) => svc.createPlanningDraft(ctx, projectId, input));
}

export async function updatePlanningDraftAction(projectId: string, input: Record<string, unknown>): Promise<ObraState> {
  return mutate<ObraError>(projectId, (ctx) => svc.updatePlanningDraft(ctx, projectId, input));
}

/** Approves the draft with the rules and calendar as sent: what staff see is what becomes the baseline. */
export async function approvePlanningDraftAction(
  projectId: string,
  input: Record<string, unknown>,
  reason: string,
): Promise<ObraState> {
  return mutate<ObraError>(projectId, (ctx) => svc.approvePlanningDraft(ctx, projectId, { ...input, reason }));
}

export async function discardPlanningDraftAction(projectId: string): Promise<ObraState> {
  return mutate<ObraError>(projectId, (ctx) => svc.discardPlanningDraft(ctx, projectId));
}
