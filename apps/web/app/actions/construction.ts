"use server";

// Thin portal adapters over @repo/core's construction control
// (packages/core/src/construction.ts), behind the project's Obra tab.

import { constructionService as svc, photosService } from "@repo/core";
import { mutate, read, type ObraState } from "./run";

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Resumen and Avance: the chapters' progress and the project's figures. */
export async function getConstructionControl(projectId: string) {
  const result = await read((ctx) => svc.getControl(ctx, projectId));
  return result && { control: result.data, canManage: result.canManage };
}

export async function getConstructionChapter(projectId: string, code: string) {
  const result = await read((ctx) => svc.getControlChapter(ctx, projectId, code));
  return result && { detail: result.data, canManage: result.canManage };
}

export async function getConstructionCosts(projectId: string) {
  const result = await read((ctx) => svc.getCosts(ctx, projectId));
  return result && { costs: result.data, canManage: result.canManage };
}

/** What every Obra page's header and forms need (ref, stage, open issues, chapters), cheaply. */
export async function getConstructionHeader(projectId: string) {
  const result = await read((ctx) => svc.getControlHeader(ctx, projectId));
  return result && { header: result.data, canManage: result.canManage };
}

export async function getConstructionIssues(projectId: string) {
  const result = await read((ctx) => svc.listIssues(ctx, projectId));
  return result && { issues: result.data, canManage: result.canManage };
}

export async function getConstructionPhotos(projectId: string) {
  const result = await read((ctx) => photosService.listPhotos(ctx, projectId));
  return result && { photos: result.data, canManage: result.canManage };
}

// ─── Progress ────────────────────────────────────────────────────────────────

export async function startChapterAction(projectId: string, code: string, date: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.startChapter(ctx, projectId, code, { date }));
}

/** → the hito whose invoice the finish asked for, if any. */
export async function finishChapterAction(
  projectId: string,
  code: string,
  date: string,
): Promise<(NonNullable<ObraState> & { invoiceRequested?: string | null }) | null> {
  let invoiceRequested: string | null = null;
  const state: ObraState = await mutate(projectId, async (ctx) => {
    ({ invoiceRequested } = await svc.finishChapter(ctx, projectId, code, { date }));
  });
  return state?.success ? { ...state, invoiceRequested } : state;
}

/** Each date as YYYY-MM-DD, or null to clear it; absent ones stay. */
export async function correctChapterAction(
  projectId: string,
  code: string,
  input: { actualStart?: string | null; actualEnd?: string | null; note?: string },
): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.correctChapter(ctx, projectId, code, input));
}

export async function reviewChangesAction(projectId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.reviewChanges(ctx, projectId));
}

// ─── Issues and changes ──────────────────────────────────────────────────────

/** → the new record's id too, to attach its files to. */
export async function createIssueAction(
  projectId: string,
  input: Record<string, unknown>,
): Promise<(NonNullable<ObraState> & { issueId?: string }) | null> {
  let issueId: string | undefined;
  const state: ObraState = await mutate(projectId, async (ctx) => {
    ({ issueId } = await svc.createIssue(ctx, projectId, input));
  });
  return state?.success ? { ...state, issueId } : state;
}

export async function updateIssueAction(
  projectId: string,
  issueId: string,
  input: Record<string, unknown>,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.updateIssue(ctx, projectId, issueId, input));
}

/** Form action: { file }. */
export async function addIssueFileAction(
  projectId: string,
  issueId: string,
  _prevState: ObraState,
  formData: FormData,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.addIssueFile(ctx, projectId, issueId, Object.fromEntries(formData)));
}

export async function deleteIssueFileAction(projectId: string, issueId: string, fileId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => svc.deleteIssueFile(ctx, projectId, issueId, fileId));
}
