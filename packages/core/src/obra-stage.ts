import { and, asc, budgetRevisions, db, eq, isNotNull, lt, projectDocuments, projects, sql } from "@repo/db";
import { CONTINGENCY_CHAPTER, type StageEvidence } from "./contract";
import { evidenceStage, stageEvidence, todayInSpain } from "./obra-calc";
import { loadObra } from "./obra-data";
import { projectInTenant } from "./project-client";

// ─── The process's stage, on its own ─────────────────────────────────────────
// The stage (1–8) follows what the platform records: the project's files, a
// budget draft, the accepted revision, H0 paid, the works started and finished
// on Avance, H9 paid (obra-calc.ts › stageEvidence). After each of those writes
// `raiseStage` moves the stage up to the last stage the evidence reaches, never
// down: a correction (a payment cancelled, a chapter reopened) leaves it where
// it is, and staff may still set it by hand on the stepper.
// ─────────────────────────────────────────────────────────────────────────────

type LoadedObra = Awaited<ReturnType<typeof loadObra>>;
type FirstDays = Awaited<ReturnType<typeof loadFirstDays>>;

const day = (at: Date | undefined) => (at ? todayInSpain(at) : null);

/**
 * What the obra doesn't hold: when the project's first file (a budget input)
 * and first budget draft came in, and when a revision was first accepted (a
 * later change order, accepted in its turn, doesn't move the day stage 4 opened).
 */
export async function loadFirstDays(tenantId: string, projectId: string) {
  const inProject = and(eq(budgetRevisions.tenantId, tenantId), eq(budgetRevisions.projectId, projectId));
  const [[input], [draft], acceptances] = await Promise.all([
    db
      .select({ at: projectDocuments.createdAt })
      .from(projectDocuments)
      .where(
        and(
          eq(projectDocuments.tenantId, tenantId),
          eq(projectDocuments.projectId, projectId),
          isNotNull(projectDocuments.budgetInput),
        ),
      )
      .orderBy(asc(projectDocuments.createdAt))
      .limit(1),
    db
      .select({ at: budgetRevisions.createdAt })
      .from(budgetRevisions)
      .where(inProject)
      .orderBy(asc(budgetRevisions.createdAt))
      .limit(1),
    // Superseding keeps a revision's acceptance.
    db
      .select({ on: budgetRevisions.acceptedOn, at: budgetRevisions.acceptedAt })
      .from(budgetRevisions)
      .where(and(inProject, isNotNull(budgetRevisions.acceptedAt))),
  ]);
  const accepted = acceptances.map(({ on, at }) => on ?? day(at ?? undefined)!).sort();
  return { firstInputOn: day(input?.at), firstDraftOn: day(draft?.at), firstAcceptedOn: accepted[0] ?? null };
}

/** What opens each stage, from the loaded obra (its contract, hitos and Avance dates) and the first days. */
export function evidenceOf(
  { revision, chapters, hitos, progressRows }: LoadedObra,
  { firstInputOn, firstDraftOn, firstAcceptedOn }: FirstDays,
): StageEvidence {
  return stageEvidence({
    firstInputOn,
    firstDraftOn,
    // While there is a contract: the day the first revision was accepted.
    acceptedOn: revision ? (firstAcceptedOn ?? revision.acceptedOn ?? day(revision.acceptedAt ?? undefined)) : null,
    paidOn: new Map(hitos.flatMap((h) => (h.paidOn ? [[h.code, h.paidOn] as const] : []))),
    // The contract's chapters, chapter 20 (the contingency reserve) aside.
    contractCodes: chapters.map((c) => c.code).filter((code) => code !== CONTINGENCY_CHAPTER),
    progress: new Map(progressRows.map((row) => [row.chapterCode, row])),
  });
}

/**
 * After a write that may add evidence: moves the project's stage up to what
 * the evidence reaches, if it is behind, and tells the client's app (its obra
 * shows the stage). Never lowers it, and never fails the caller (the write has
 * succeeded; the next one catches the stage up). Returns the new stage, or null.
 */
export async function raiseStage(tenantId: string, projectId: string) {
  try {
    const [obra, firsts] = await Promise.all([loadObra(tenantId, projectId), loadFirstDays(tenantId, projectId)]);
    const stage = evidenceStage(evidenceOf(obra, firsts));
    const [raised] = await db
      .update(projects)
      .set({ obraStage: stage, obraRev: sql`${projects.obraRev} + 1`, updatedAt: new Date() })
      .where(and(projectInTenant(tenantId, projectId), lt(projects.obraStage, stage)))
      .returning({ id: projects.id });
    return raised ? stage : null;
  } catch (error) {
    console.error("Failed to raise the stage of project", projectId, error);
    return null;
  }
}
