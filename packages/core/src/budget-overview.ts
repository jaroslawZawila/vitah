import { budgetChapters, budgetGenerations, budgetLines, budgetRevisions, db, desc, eq, inArray } from "@repo/db";
import { revisionChecks, toSummary } from "./budget";
import { tenantRatiosByProject } from "./budget-review";
import type { Ctx } from "./context";
import {
  amountCents,
  BUDGET_MODEL,
  expiresSoon,
  isGenerating,
  perM2High,
  type BudgetOverview,
  type BudgetOverviewItem,
  type BudgetOverviewRevision,
} from "./contract";
import { perM2Cents, priceLines, shareBp, todayInSpain } from "./obra-calc";
import type { RevisionRow } from "./obra-data";
import { listProjects } from "./projects";
import { daysBetween } from "./subcontractor-rules";

// ─── Budget overview ─────────────────────────────────────────────────────────
// Proyectos › Presupuestos: every obra's budget in its newest revision, as the
// Budget tab shows it (the PEC at the client's price, margins in), with what it
// waits for: the AI, unticked review checks, the client, an expiring offer.
// The same list lets staff switch obra beside a budget. Read-only, all staff.
// ─────────────────────────────────────────────────────────────────────────────

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Each project's newest revision. */
function newestRevisions(tenantId: string) {
  return db
    .selectDistinctOn([budgetRevisions.projectId])
    .from(budgetRevisions)
    .where(eq(budgetRevisions.tenantId, tenantId))
    .orderBy(budgetRevisions.projectId, desc(budgetRevisions.number));
}

/** Each project's newest AI run. */
function newestGenerations(tenantId: string) {
  return db
    .selectDistinctOn([budgetGenerations.projectId], {
      projectId: budgetGenerations.projectId,
      status: budgetGenerations.status,
      step: budgetGenerations.step,
      updatedAt: budgetGenerations.updatedAt,
    })
    .from(budgetGenerations)
    .where(eq(budgetGenerations.tenantId, tenantId))
    .orderBy(budgetGenerations.projectId, desc(budgetGenerations.createdAt));
}

type Line = { quantity: number; unitPriceCents: number; amountCents: number };
type Contents = { chapters: Line[]; chosen: Line[]; chosenOptions: Set<string> };

/** The revisions' chapter lines and the lines of the options chosen: only the figures, all at once. */
async function contentsOf(revisionIds: string[]) {
  const contents = new Map<string, Contents>(revisionIds.map((id) => [id, { chapters: [], chosen: [], chosenOptions: new Set() }]));
  if (revisionIds.length === 0) return contents;
  const rows = await db
    .select({
      revisionId: budgetChapters.revisionId,
      chapterId: budgetChapters.id,
      kind: budgetChapters.kind,
      chosen: budgetChapters.chosen,
      quantityMilli: budgetLines.quantityMilli,
      unitPriceCents: budgetLines.unitPriceCents,
    })
    .from(budgetChapters)
    .leftJoin(budgetLines, eq(budgetLines.chapterId, budgetChapters.id))
    .where(inArray(budgetChapters.revisionId, revisionIds));
  for (const row of rows) {
    const entry = contents.get(row.revisionId)!;
    const option = row.kind === "option";
    if (option && !row.chosen) continue;
    if (option) entry.chosenOptions.add(row.chapterId);
    if (row.quantityMilli === null || row.unitPriceCents === null) continue;
    // As loadChapters reads a line.
    (option ? entry.chosen : entry.chapters).push({
      quantity: row.quantityMilli / 1000,
      unitPriceCents: row.unitPriceCents,
      amountCents: amountCents(row.quantityMilli, row.unitPriceCents),
    });
  }
  return contents;
}

/** Only a FRAMER draft has a checklist. */
const hasChecklist = (row: RevisionRow) => row.status === "draft" && row.model === BUDGET_MODEL;

/** A revision's figures as its Budget tab works them out (`revisionView`), at the client's price. */
async function figures(
  row: RevisionRow,
  contents: Contents,
  today: string,
  /** The tenant's €/m² averages leaving a project out, for a draft's checks. */
  ratiosFor: ((projectId: string) => Record<string, number>) | null,
): Promise<Omit<BudgetOverviewRevision, "perM2DeltaBp">> {
  const price = (lines: Line[]) => sum(priceLines(lines, row).map((l) => l.amountCents));
  const totalCents = price(contents.chapters);
  const checks = ratiosFor && hasChecklist(row) ? await revisionChecks(row, ratiosFor(row.projectId)) : null;
  return {
    ...toSummary(row, totalCents),
    costCents: sum(contents.chapters.map((l) => l.amountCents)),
    contractTotalCents: totalCents + price(contents.chosen),
    chosenOptions: contents.chosenOptions.size,
    perM2Cents: perM2Cents(totalCents, row.builtAreaCm2),
    validUntil: row.validUntil,
    acceptedOn: row.acceptedOn,
    rejectedOn: row.rejectedOn,
    openChecks: checks && checks.filter((c) => !c.done).length,
    daysLeft: row.status === "issued" && row.validUntil ? daysBetween(today, row.validUntil) : null,
  };
}

/** Every obra of the tenant with its budget, the one changed last first, and the totals over them. */
export async function listBudgets(ctx: Ctx): Promise<BudgetOverview> {
  const today = todayInSpain();
  const [projects, revisions, generations] = await Promise.all([
    listProjects(ctx),
    newestRevisions(ctx.tenantId),
    newestGenerations(ctx.tenantId),
  ]);
  const [contents, ratiosFor] = await Promise.all([
    contentsOf(revisions.map((r) => r.id)),
    revisions.some(hasChecklist) ? tenantRatiosByProject(ctx.tenantId) : null,
  ]);
  const loaded = await Promise.all(revisions.map((row) => figures(row, contents.get(row.id)!, today, ratiosFor)));
  const revisionOf = new Map(revisions.map((row, i) => [row.projectId, { row, figures: loaded[i]! }]));
  const generationOf = new Map(generations.map((g) => [g.projectId, g]));

  const accepted = loaded.filter((r) => r.status === "accepted");
  const acceptedPerM2 = accepted.flatMap((r) => (r.perM2Cents === null ? [] : [r.perM2Cents]));
  const averagePerM2Cents = acceptedPerM2.length > 0 ? Math.round(sum(acceptedPerM2) / acceptedPerM2.length) : null;

  const items: BudgetOverviewItem[] = projects.map((project) => {
    const found = revisionOf.get(project.id);
    const generation = found ? undefined : generationOf.get(project.id);
    const perM2 = found?.figures.perM2Cents ?? null;
    return {
      projectId: project.id,
      ref: project.ref,
      address: project.address,
      clientName: project.client ? (project.client.name ?? project.client.email) : null,
      revision: found
        ? { ...found.figures, perM2DeltaBp: perM2 !== null && averagePerM2Cents ? shareBp(perM2 - averagePerM2Cents, averagePerM2Cents) : null }
        : null,
      generation: generation ? { status: generation.status, step: generation.step } : null,
      // A draft's every write touches its revision (`inDraft`).
      updatedAt: (found?.row.updatedAt ?? generation?.updatedAt ?? project.createdAt).toISOString(),
    };
  });
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const withRevision = items.flatMap((i) => (i.revision ? [i.revision] : []));
  const issued = withRevision.filter((r) => r.status === "issued");
  return {
    items,
    summary: {
      drafts: withRevision.filter((r) => r.status === "draft").length,
      generating: items.filter(isGenerating).length,
      openChecks: sum(withRevision.map((r) => r.openChecks ?? 0)),
      issued: issued.length,
      issuedCents: sum(issued.map((r) => r.totalCents)),
      expiring: issued.filter((r) => expiresSoon(r.daysLeft)).length,
      accepted: accepted.length,
      contractCents: sum(accepted.map((r) => r.contractTotalCents)),
      averagePerM2Cents,
      aboveAverage: withRevision.filter((r) => perM2High(r.perM2DeltaBp)).length,
    },
  };
}
