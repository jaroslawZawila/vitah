import { db, eq, projects } from "@repo/db";
import { toCalendarDate } from "./calendar";
import { requireEditor, type Ctx } from "./context";
import {
  OBRA_STAGES,
  type BudgetChapter,
  type Hito,
  type MobileObra,
  type ProjectObra,
  type ProjectPhoto,
} from "./contract";
import { toBudgetChapters } from "./budget";
import {
  asStage,
  clientProject,
  fail,
  loadObra,
  requireProject,
  type ObraProject,
} from "./obra-data";
import { buildPhases, obraTerm, shareBp, todayInSpain } from "./obra-calc";
import { listPhotos, photosByChapter } from "./photos";

// ─── Obra ────────────────────────────────────────────────────────────────────
// The construction process of a project as a whole: its stage (1–8), progress
// from the budget, payments from the hitos, and the works' calendar. The
// portal's Obra page and the app's Obra tab read from here.
// ─────────────────────────────────────────────────────────────────────────────

function termOf(project: ObraProject, totalCents: number) {
  const start = toCalendarDate(project.startDate);
  const end = toCalendarDate(project.completionDate);
  return start && end ? obraTerm(start, end, todayInSpain(), totalCents) : null;
}

/** What the hitos in `status` add up to, without VAT. */
const sumAmounts = (hitos: Hito[], status: Hito["status"]) =>
  hitos.filter((h) => h.status === status).reduce((sum, h) => sum + h.amountCents, 0);

/** Which hito closes each chapter code. */
const hitoByChapter = (hitos: Hito[]) =>
  new Map(hitos.flatMap((h) => h.chapters.map((c) => [c.code, h.code] as const)));

export async function getObra(ctx: Ctx, projectId: string): Promise<ProjectObra> {
  const [project, { revision, chapters, progress, vatRateBp, hitos }] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    loadObra(ctx.tenantId, projectId),
  ]);
  const hitoOf = hitoByChapter(hitos);
  const paidCents = sumAmounts(hitos, "paid");
  const invoicedUnpaidCents = sumAmounts(hitos, "invoiced");

  return {
    stage: asStage(project.obraStage),
    budget: revision && {
      revisionId: revision.id,
      number: revision.number,
      reference: revision.reference,
      totalCents: progress.totalCents,
      vatRateBp,
      acceptedAt: revision.acceptedAt?.toISOString() ?? null,
    },
    executedCents: progress.executedCents,
    progressPct: progress.progressPct,
    paidCents,
    invoicedUnpaidCents,
    toInvoiceCents: progress.totalCents - paidCents - invoicedUnpaidCents,
    planPctBp: hitos.reduce((sum, h) => sum + h.pctBp, 0),
    term: termOf(project, progress.totalCents),
    chapters: chapters.map(({ code, name, totalCents, executedCents, progressPct, status }) => ({
      code,
      name,
      totalCents,
      executedCents,
      progressPct,
      status,
      shareBp: shareBp(totalCents, progress.totalCents),
      hitoCode: hitoOf.get(code) ?? null,
    })),
    hitos,
  };
}

/** Body: { stage: 1–8 } */
export async function setStage(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  await requireProject(ctx.tenantId, projectId);
  const stage = OBRA_STAGES.find((s) => s === input.stage);
  if (!stage) fail("invalid_stage");
  await db
    .update(projects)
    .set({ obraStage: stage, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  return { stage };
}

/** One chapter of the accepted budget, with the hito that closes it and its photos. */
export async function getChapter(
  ctx: Ctx,
  projectId: string,
  code: string,
): Promise<{ chapter: BudgetChapter; hito: Hito | null; photos: ProjectPhoto[] }> {
  const [{ revision, chapters, progress, hitos }, photos] = await Promise.all([
    loadObra(ctx.tenantId, projectId),
    // Checks the project is in the tenant.
    listPhotos(ctx, projectId, { chapterCode: code }),
  ]);
  if (!revision) fail("no_budget");
  const own = chapters.filter((c) => c.code === code);
  if (own.length === 0) fail("not_found");
  // Not compared with the previous revision here: that is the Budget's view.
  const [chapter] = toBudgetChapters(own, null, progress.totalCents, hitoByChapter(hitos));
  return {
    chapter: chapter!,
    hito: hitos.find((h) => h.chapters.some((c) => c.code === code)) ?? null,
    photos,
  };
}

// ─── Mobile app ──────────────────────────────────────────────────────────────

/**
 * The Obra tab of the client's app: null when no project is attached. Called
 * with the client's own identity (from their mobile token).
 */
export async function getClientObra(
  tenantId: string,
  clientUserId: string,
): Promise<MobileObra | null> {
  const project = await clientProject(tenantId, clientUserId);
  if (!project) return null;
  const stage = asStage(project.obraStage);
  const [{ progress, vatRateBp, hitos }, photos] = await Promise.all([
    loadObra(tenantId, project.id),
    photosByChapter(tenantId, project.id),
  ]);
  // The client sees the calendar, not the contract penalty.
  const { penaltyCents: _, ...term } = termOf(project, progress.totalCents) ?? {};
  const phases = hitos.length > 0 ? buildPhases(stage, hitos, photos) : [];

  return {
    stage,
    progressPct: progress.progressPct,
    totalCents: progress.totalCents,
    vatRateBp,
    paidCents: sumAmounts(hitos, "paid"),
    term: "startDate" in term ? term : null,
    phases,
    currentPhaseKey: phases.find((p) => p.status !== "done")?.key ?? null,
    hitos,
  };
}
