import { createElement } from "react";
import { and, asc, budgetRevisions, db, eq, lte, obraHitos, projectDocuments, projects, tenants } from "@repo/db";
import { getBudget } from "./budget";
import { revisionInProject } from "./budget-draft";
import { money, monthLabel, type BudgetPdfData, type Letterhead } from "./budget-pdf/format";
import { markChanged } from "./changes";
import type { Ctx } from "./context";
import { CONTINGENCY_CHAPTER, promoterName, type BudgetPdfKind, type BudgetRevision, type ProjectBudget } from "./contract";
import { newPdfDocument, openDocument } from "./documents";
import { notifyProjectClient } from "./notifications";
import { addDays, forClient, perM2Cents, todayInSpain } from "./obra-calc";
import { calendarDate, fail, optionalText } from "./obra-data";
import { storeFiles, type StoredFile } from "./project-files";

// ─── Issuing a budget ─────────────────────────────────────────────────────────
// Issuing freezes a draft and stores its two PDFs (general and detailed) as
// project documents; the general one can go straight to the client's app.
// Until then the PDFs are rendered on the fly, marked "BORRADOR".
// ─────────────────────────────────────────────────────────────────────────────

const MAX_NOTE = 2_000;

async function letterheadOf(tenantId: string): Promise<Letterhead & { jurisdiction: string; mediator: string }> {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { name: true, letterhead: true } });
  const stored = (tenant?.letterhead ?? {}) as Partial<Letterhead & { jurisdiction: string; mediator: string }>;
  return {
    name: stored.name || tenant?.name || "",
    tagline: stored.tagline ?? "",
    address: stored.address ?? "",
    phone: stored.phone ?? "",
    jurisdiction: stored.jurisdiction ?? "",
    mediator: stored.mediator ?? "",
  };
}

/** Everything the PDFs print of a revision, either kind (`budget` lists every revision's PEC). */
async function pdfData(
  ctx: Ctx,
  projectId: string,
  budget: ProjectBudget,
  atCost: BudgetRevision,
): Promise<Omit<BudgetPdfData, "kind">> {
  // Neither PDF shows the margins apart: the detailed one carries the contract
  // the client signs. The portal's budget does.
  const revision = forClient(atCost);
  const [letterhead, project, hitos, history] = await Promise.all([
    letterheadOf(ctx.tenantId),
    db.query.projects.findFirst({ where: eq(projects.id, projectId), columns: { address: true } }),
    db
      .select({
        code: obraHitos.code,
        name: obraHitos.name,
        scope: obraHitos.scope,
        pctBp: obraHitos.pctBp,
        billingMoment: obraHitos.billingMoment,
      })
      .from(obraHitos)
      .where(eq(obraHitos.projectId, projectId))
      .orderBy(asc(obraHitos.position)),
    db
      .select({
        number: budgetRevisions.number,
        issuedOn: budgetRevisions.issuedOn,
        reason: budgetRevisions.changeReason,
        id: budgetRevisions.id,
      })
      .from(budgetRevisions)
      .where(and(eq(budgetRevisions.projectId, projectId), lte(budgetRevisions.number, revision.number)))
      .orderBy(budgetRevisions.number),
  ]);
  const totals = new Map(budget.revisions.map((r) => [r.id, r.totalCents]));
  const issuedOn = revision.issuedOn ?? todayInSpain();
  const builtAreaCm2 = revision.builtAreaM2 ? Math.round(revision.builtAreaM2 * 100) : null;
  const usefulAreaCm2 = revision.usefulAreaM2 ? Math.round(revision.usefulAreaM2 * 100) : null;
  const cover = revision.texts.cover;
  const site = cover.site || project?.address || "";
  const contingency = revision.chapters.find((c) => c.code === CONTINGENCY_CHAPTER);
  return {
    draft: revision.status === "draft",
    revision,
    letterhead,
    site,
    issuedLabel: monthLabel(issuedOn),
    year: Number(issuedOn.slice(0, 4)),
    builtAreaCm2,
    usefulAreaCm2,
    perBuilt: perM2Cents(revision.totalCents, builtAreaCm2),
    perUseful: perM2Cents(revision.totalCents, usefulAreaCm2),
    contingencyBase: revision.totalCents - (contingency?.totalCents ?? 0),
    hitos,
    history: history.map((h) => ({
      number: h.number,
      date: h.number === revision.number ? issuedOn : (h.issuedOn ?? ""),
      reason: h.number === revision.number ? revision.changeReason : h.reason,
      totalCents: totals.get(h.id) ?? 0,
    })),
    contractValues: {
      contractor: [letterhead.name, letterhead.address ? `con domicilio en ${letterhead.address}` : "", letterhead.phone ? `Tel. ${letterhead.phone}` : ""]
        .filter(Boolean)
        .join(", "),
      promoter: promoterName(cover.promoter),
      site: [site, cover.cadastral].filter(Boolean).join(", "),
      basis: cover.basis || "proyecto de referencia",
      price: `${money(revision.totalCents)} €`,
      term: revision.conditions.term,
      penalty: revision.conditions.penalty,
      jurisdiction: letterhead.jurisdiction || "la sede del CONTRATISTA",
      mediator: letterhead.mediator || "Colegio Oficial de Aparejadores y Arquitectos Técnicos de la provincia de la obra",
    },
  };
}

const pdfTitle = (revision: BudgetRevision, kind: BudgetPdfKind) =>
  `Presupuesto ${revision.reference ?? ""} · Rev.${revision.number} · ${kind === "general" ? "general" : "detallado"}`.replace("  ", " ");

/**
 * react-pdf and the embedded fonts load on first use: everything else that
 * imports @repo/core (every route, the app's polling) stays light.
 */
async function render(data: Omit<BudgetPdfData, "kind">, kind: BudgetPdfKind): Promise<Uint8Array> {
  const [{ renderToBuffer }, { BudgetPdf }] = await Promise.all([import("@react-pdf/renderer"), import("./budget-pdf/BudgetPdf")]);
  const element = createElement(BudgetPdf, { d: { ...data, kind } }) as Parameters<typeof renderToBuffer>[0];
  return new Uint8Array(await renderToBuffer(element));
}

/**
 * A revision's PDF: the stored one once issued (what the client got), else
 * rendered now and marked "BORRADOR". Any staff member may read it.
 */
export async function revisionPdf(
  ctx: Ctx,
  projectId: string,
  revisionId: string,
  kind: BudgetPdfKind,
): Promise<StoredFile> {
  // Once issued, the stored file, without building the revision.
  const [stored] = await db
    .select({ id: projectDocuments.id })
    .from(projectDocuments)
    .where(
      and(
        eq(projectDocuments.tenantId, ctx.tenantId),
        eq(projectDocuments.projectId, projectId),
        eq(projectDocuments.budgetRevisionId, revisionId),
        eq(projectDocuments.budgetPdf, kind),
      ),
    );
  if (stored) return openDocument(ctx, projectId, stored.id);
  const budget = await getBudget(ctx, projectId, revisionId);
  const revision = budget.revision;
  if (!revision) fail("not_found");
  const bytes = await render(await pdfData(ctx, projectId, budget, revision), kind);
  return {
    filename: `${pdfTitle(revision, kind)}.pdf`,
    contentType: "application/pdf",
    sizeBytes: bytes.byteLength,
    body: new Blob([new Uint8Array(bytes)]).stream(),
  };
}

/**
 * Issues a draft to the client: renders and stores both PDFs (the general
 * one visible in the app when `shareWithClient`), then freezes the revision.
 * Rev.1 and later need the reason for the change.
 * Body: { issuedOn?, validUntil?, changeReason?, shareWithClient? (default true) }
 */
export async function issueRevision(ctx: Ctx, projectId: string, revisionId: string, input: Record<string, unknown> = {}) {
  const row = await revisionInProject(ctx, projectId, revisionId);
  const changeReason = input.changeReason === undefined ? row.changeReason : optionalText(input.changeReason, MAX_NOTE);
  if (row.number > 0 && !changeReason) fail("change_reason_required");
  const issuedOn = input.issuedOn === undefined ? todayInSpain() : calendarDate(input.issuedOn);
  const shareWithClient = input.shareWithClient !== false;

  // All under the revision's row lock, which every draft edit takes (inDraft):
  // the PDFs are of exactly what gets frozen, and if storing them fails the
  // revision stays a draft and can be issued again.
  const title = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: budgetRevisions.status })
      .from(budgetRevisions)
      .where(eq(budgetRevisions.id, revisionId))
      .for("update");
    if (locked?.status !== "draft") fail("not_draft");

    // The PDFs show the revision as issued: its date and reason, no watermark.
    const budget = await getBudget(ctx, projectId, revisionId);
    const view = budget.revision!;
    const validUntil =
      input.validUntil === undefined ? addDays(issuedOn, view.conditions.validityDays) : calendarDate(input.validUntil);
    const revision: BudgetRevision = { ...view, status: "issued", issuedOn, validUntil, changeReason };
    const data = await pdfData(ctx, projectId, budget, revision);
    const docs = await Promise.all(
      (["general", "detailed"] as const).map(async (kind) => {
        const bytes = await render(data, kind);
        return newPdfDocument(ctx, projectId, new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), {
          title: pdfTitle(revision, kind),
          category: "budget",
          visibleToClient: kind === "general" && shareWithClient,
          budgetRevisionId: revisionId,
          budgetPdf: kind,
        });
      }),
    );
    await storeFiles(
      docs.map((d) => d.file),
      async () => {
        await tx.insert(projectDocuments).values(docs.map((d) => d.row));
        await tx
          .update(budgetRevisions)
          .set({ status: "issued", issuedOn, validUntil, changeReason })
          .where(eq(budgetRevisions.id, revisionId));
      },
    );
    return pdfTitle(revision, "general");
  });
  if (shareWithClient) {
    await markChanged(ctx.tenantId, projectId, ["documents"]);
    await notifyProjectClient(ctx.tenantId, projectId, { kind: "document", title });
  }
  return { revisionId };
}
