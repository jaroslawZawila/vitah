import type { Ctx } from "../context";
import * as budget from "../budget";
import * as hitos from "../hitos";
import * as obra from "../obra";
import { CASTRILLON_BUDGET } from "./castrillon";

// ─── Demo obra ───────────────────────────────────────────────────────────────
// Loads the real Castrillón budget (Rev.3) into a project and records a
// snapshot half way through the works: foundation and structure built, the
// envelope under way, H0–H2 paid and H3 invoiced. Used by `pnpm db:seed` for
// the local dev project, and by tests as a realistic fixture.
// ─────────────────────────────────────────────────────────────────────────────

/** Executed % by line code; a chapter code applies to all its lines. */
const PROGRESS: Record<string, number> = {
  "01": 100,
  "02": 100,
  "03": 100,
  "04": 100,
  "05.01": 100,
  "05.02": 100,
  "05.03": 60,
  "05.04": 20,
  "05.06": 15,
  "07": 60,
  "10": 40,
  "12": 15,
  "13": 10,
  "16": 50,
};

const pdf = (text: string) => new File([`%PDF-1.4\n% ${text}\n`], `${text}.pdf`, { type: "application/pdf" });

/**
 * `files: false` leaves out the acta and invoice PDFs (H2 is then only paid,
 * H3 ready for its acta), for when no Blob store is configured.
 */
export async function seedObra(ctx: Ctx, projectId: string, { files = true } = {}) {
  const { reference, number, builtAreaM2, usefulAreaM2, exclusions, chapters } = CASTRILLON_BUDGET;
  const { revisionId } = await budget.createBudget(ctx, projectId, { reference, number });
  await budget.updateRevision(ctx, projectId, revisionId, { builtAreaM2, usefulAreaM2, exclusions });
  for (const { lines, ...chapter } of chapters) {
    const { chapterId } = await budget.addChapter(ctx, projectId, revisionId, chapter);
    for (const line of lines) await budget.addLine(ctx, projectId, chapterId, line);
  }
  await budget.acceptRevision(ctx, projectId, revisionId);

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
