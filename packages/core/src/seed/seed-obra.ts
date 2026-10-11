import type { Ctx } from "../context";
import * as budget from "../budget";
import * as options from "../budget-options";
import * as hitos from "../hitos";
import * as obra from "../obra";
import { CAVIEDES_BUDGET } from "./caviedes";

// ─── Demo obra ───────────────────────────────────────────────────────────────
// Loads the real Caviedes budget (004/2026, the FRAMER model: twenty chapters
// and the pool as an option) into a project as the accepted contract, then
// records a snapshot part way through the works: foundation and structure
// built, the envelope under way, H0–H2 paid and H3 invoiced. Used by
// `pnpm db:seed` for the local dev project, and by tests as a realistic fixture.
// ─────────────────────────────────────────────────────────────────────────────

/** Executed % by line code; a chapter code applies to all its lines. */
const PROGRESS: Record<string, number> = {
  "01": 100,
  "02": 100,
  "03": 100,
  "05.01": 100,
  "05.02": 100,
  "05.03": 60,
  "06.01": 80,
  "06.02": 80,
  "06.03": 40,
  "10.01": 50,
  "18": 50,
  "19": 30,
};

const pdf = (text: string) => new File([`%PDF-1.4\n% ${text}\n`], `${text}.pdf`, { type: "application/pdf" });

/** The Caviedes budget as an accepted Rev.0 (the pool offered, not chosen). */
export async function seedBudget(ctx: Ctx, projectId: string, { accept = true } = {}) {
  const { reference, builtAreaM2, usefulAreaM2, chapters, texts, conditions } = CAVIEDES_BUDGET;
  const { revisionId } = await budget.createBudget(ctx, projectId, { reference });
  await budget.updateRevision(ctx, projectId, revisionId, {
    builtAreaM2,
    usefulAreaM2,
    texts: { ...texts, annex: texts.annex.map((item, i) => ({ ...item, id: `n${i + 1}` })) },
    conditions,
  });
  const { revision } = await budget.getBudget(ctx, projectId, revisionId);
  const chapterIds = new Map(revision!.chapters.map((c) => [c.code, c.id]));
  for (const chapter of chapters) {
    const chapterId = chapterIds.get(chapter.code)!;
    await budget.updateChapter(ctx, projectId, chapterId, { name: chapter.name, pdfNote: chapter.note ?? null });
    for (const line of chapter.lines) await budget.addLine(ctx, projectId, chapterId, { ...line, source: "base" });
  }
  for (const option of CAVIEDES_BUDGET.options) {
    const intro = [option.intro, option.footnote].filter(Boolean).join("\n\n");
    const { optionId } = await options.addOption(ctx, projectId, revisionId, { name: option.name, optionKind: option.optionKind, intro });
    for (const { code: _, ...line } of option.lines) await budget.addLine(ctx, projectId, optionId, line);
  }
  const plan = await hitos.listHitos(ctx, projectId);
  await hitos.updatePlan(ctx, projectId, {
    hitos: CAVIEDES_BUDGET.hitos.map(({ code, ...values }) => ({ id: plan.find((h) => h.code === code)!.id, ...values })),
  });
  if (accept) await budget.acceptRevision(ctx, projectId, revisionId, { acceptedOn: "2026-01-15", acceptedBy: "D. Fernando Barcenilla" });
  return { revisionId };
}

/**
 * `files: false` leaves out the acta and invoice PDFs (H2 is then only paid,
 * H3 ready for its acta), for when no Blob store is configured.
 */
export async function seedObra(ctx: Ctx, projectId: string, { files = true } = {}) {
  const { revisionId } = await seedBudget(ctx, projectId);

  const { revision } = await budget.getBudget(ctx, projectId, revisionId);
  const lines = revision!.chapters.flatMap((c) =>
    c.lines.flatMap((line) => {
      const executedPct = PROGRESS[line.code] ?? PROGRESS[c.code];
      return executedPct ? [{ id: line.id, executedPct }] : [];
    }),
  );
  await budget.setProgress(ctx, projectId, { lines });
  await obra.setStage(ctx, projectId, { stage: 6 });

  const plan = await hitos.listHitos(ctx, projectId);
  const hito = (code: string) => plan.find((h) => h.code === code)!;
  for (const check of hito("H1").checks) {
    await hitos.updateCheck(ctx, projectId, check.id, { done: true });
  }
  await hitos.registerPayment(ctx, projectId, hito("H0").id, { paidOn: "2026-02-03" });
  await hitos.registerPayment(ctx, projectId, hito("H1").id, { paidOn: "2026-04-20" });
  if (files) {
    for (const [code, date] of [["H2", "2026-07-20"], ["H3", "2026-09-24"]] as const) {
      for (const kind of ["acta", "invoice"] as const) {
        const file = pdf(`${kind === "acta" ? "Acta" : "Factura"} ${code}`);
        await hitos.uploadHitoFile(ctx, projectId, hito(code).id, kind, { file, date });
      }
    }
  }
  await hitos.registerPayment(ctx, projectId, hito("H2").id, { paidOn: "2026-07-24" });
}
