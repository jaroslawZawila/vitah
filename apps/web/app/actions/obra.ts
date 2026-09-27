"use server";

// Thin portal adapters over @repo/core's obra and hitos services
// (packages/core/src/obra.ts, hitos.ts), behind the project's Obra and
// Payments tabs.

import {
  budgetService,
  hitosService,
  obraService,
  photosService,
  type HitoFileKind,
} from "@repo/core";
import { mutate, read, type ObraState } from "./run";

export type { ObraState };

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function getProjectObra(projectId: string) {
  const result = await read((ctx) => obraService.getObra(ctx, projectId));
  return result && { obra: result.data, canManage: result.canManage };
}

export async function getProjectChapter(projectId: string, code: string) {
  const result = await read((ctx) => obraService.getChapter(ctx, projectId, code));
  return result && { ...result.data, canManage: result.canManage };
}

/** A hito, with the project's photos to pick its acta's from. */
export async function getProjectHito(projectId: string, hitoId: string) {
  const result = await read(async (ctx) => {
    const [hito, photos] = await Promise.all([
      hitosService.getHito(ctx, projectId, hitoId),
      photosService.listPhotos(ctx, projectId),
    ]);
    return { hito, photos };
  });
  return result && { ...result.data, canManage: result.canManage };
}

// ─── Obra ────────────────────────────────────────────────────────────────────

export async function setObraStageAction(projectId: string, stage: number): Promise<ObraState> {
  return mutate(projectId, (ctx) => obraService.setStage(ctx, projectId, { stage }));
}

export async function saveProgressAction(
  projectId: string,
  lines: { id: string; executedPct: number }[],
): Promise<ObraState> {
  // Progress is recorded on the budget's lines.
  return mutate(projectId, (ctx) => budgetService.setProgress(ctx, projectId, { lines }));
}

// ─── Hitos ───────────────────────────────────────────────────────────────────

export async function updateHitoAction(
  projectId: string,
  hitoId: string,
  input: Record<string, unknown>,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => hitosService.updateHito(ctx, projectId, hitoId, input));
}

/** The Payments tab's plan editor: several hitos' % and chapters, all or nothing. */
export async function savePlanAction(
  projectId: string,
  hitos: { id: string; pctBp: number; chapterCodes: string[] }[],
): Promise<ObraState> {
  return mutate(projectId, (ctx) => hitosService.updatePlan(ctx, projectId, { hitos }));
}

export async function addCheckAction(
  projectId: string,
  hitoId: string,
  label: string,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => hitosService.addCheck(ctx, projectId, hitoId, { label }));
}

export async function updateCheckAction(
  projectId: string,
  checkId: string,
  input: { label?: string; done?: boolean },
): Promise<ObraState> {
  return mutate(projectId, (ctx) => hitosService.updateCheck(ctx, projectId, checkId, input));
}

export async function deleteCheckAction(projectId: string, checkId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => hitosService.deleteCheck(ctx, projectId, checkId));
}

export async function setActaPhotosAction(
  projectId: string,
  hitoId: string,
  photoIds: string[],
): Promise<ObraState> {
  return mutate(projectId, (ctx) =>
    hitosService.setActaPhotos(ctx, projectId, hitoId, { photoIds }),
  );
}

/** Form action: { file, date }. */
export async function uploadHitoFileAction(
  projectId: string,
  hitoId: string,
  kind: HitoFileKind,
  _prevState: ObraState,
  formData: FormData,
): Promise<ObraState> {
  return mutate(projectId, (ctx) =>
    hitosService.uploadHitoFile(ctx, projectId, hitoId, kind, Object.fromEntries(formData)),
  );
}

export async function removeHitoFileAction(
  projectId: string,
  hitoId: string,
  kind: HitoFileKind,
): Promise<ObraState> {
  return mutate(projectId, (ctx) => hitosService.removeHitoFile(ctx, projectId, hitoId, kind));
}

export async function registerPaymentAction(
  projectId: string,
  hitoId: string,
  input: { paidOn: string; amountCents?: number },
): Promise<ObraState> {
  return mutate(projectId, (ctx) => hitosService.registerPayment(ctx, projectId, hitoId, input));
}

export async function cancelPaymentAction(projectId: string, hitoId: string): Promise<ObraState> {
  return mutate(projectId, (ctx) => hitosService.cancelPayment(ctx, projectId, hitoId));
}
