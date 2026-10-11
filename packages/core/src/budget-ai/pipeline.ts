import {
  and,
  budgetGenerations,
  budgetLines,
  db,
  eq,
  inArray,
  sql,
} from "@repo/db";
import { insertFramerRevision } from "../budget";
import { lockForFirstBudget, syncDraft } from "../budget-draft";
import type { GenerationOptions, GenerationRow } from "../budget-generations";
import { markChanged } from "../changes";
import { CoreError } from "../errors";
import { ACTIVE_GENERATION_STATUSES, lineAmountCents, type BudgetGenerationLogEntry, type BudgetInput } from "../contract";
import { budgetInputs, setClaudeFileId } from "../documents";
import { readFile } from "../storage";
import { ClaudeError, MODELS, structuredCall, uploadFile, type CallContext, type ContentBlock } from "./claude";
import { measurementText, parseBc3, parseXlsx } from "./measurements";
import { chapterNotes, toDraftLines, toTexts } from "./postprocess";
import { extractionPrompt, groupInstruction, groupPrompt, GROUPS } from "./prompts";
import { ChapterLines, ProjectExtraction } from "./schemas";

// ─── The generation pipeline ──────────────────────────────────────────────────
// The steps of features/budget/PROMPTS_IA.md §1, each a function the workflow
// (apps/web/workflows/generate-budget.ts) runs as a durable step. Each stores
// its result on the generation row and returns nothing big, so a retried step
// finds its work done and returns at once.
//   0 prepareInputs   PDFs and images → Claude's Files API; BC3/Excel → text
//   1 extractProject  Opus reads everything → the project's data and texts
//   2–5 generateGroup Sonnet writes chapters 01–05, 06–10, 11–15, 16–19
//   saveDraft         post-processing → Rev.0 (draft) with its 20 chapters
// ─────────────────────────────────────────────────────────────────────────────

type InputFile = { documentId: string; kind: BudgetInput; title: string; fileId: string; type: "document" | "image" };
type PipelineState = {
  inputs?: { files: InputFile[]; measurements: string };
  groups?: Record<string, ChapterLines>;
};

/** The generation was cancelled: stop quietly. */
export class GenerationStopped extends Error {}

/** A failure no retry will fix; `code` is what the portal words for staff. */
export class GenerationFailed extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
  }
}

const INPUT_LABELS: Record<BudgetInput, string> = {
  plans: "Planos",
  basic: "Proyecto básico",
  execution: "Proyecto de ejecución",
  measurements: "Mediciones",
};

/** The generation, unless it was cancelled; marks it running. */
async function load(generationId: string): Promise<GenerationRow & { state: PipelineState }> {
  const [row] = await db
    .update(budgetGenerations)
    .set({ status: sql`case when ${budgetGenerations.status} = 'queued' then 'running' else ${budgetGenerations.status} end` })
    .where(eq(budgetGenerations.id, generationId))
    .returning();
  if (!row) throw new GenerationFailed("not_found");
  if (row.status === "cancelled") throw new GenerationStopped();
  if (row.status !== "running") throw new GenerationFailed("not_running", `Generation is ${row.status}`);
  return row as GenerationRow & { state: PipelineState };
}

/** Appends a progress line (and sets `step`, at least). */
async function log(generationId: string, entry: Omit<BudgetGenerationLogEntry, "at">) {
  const line: BudgetGenerationLogEntry = { at: new Date().toISOString(), ...entry };
  await db
    .update(budgetGenerations)
    .set({
      log: sql`${budgetGenerations.log} || ${JSON.stringify([line])}::jsonb`,
      step: sql`greatest(${budgetGenerations.step}, ${entry.step})`,
    })
    .where(eq(budgetGenerations.id, generationId));
}

const callContext = (row: GenerationRow, purpose: string): CallContext => ({
  tenantId: row.tenantId,
  userId: row.createdById,
  projectId: row.projectId,
  generationId: row.id,
  purpose,
});

async function readBytes(pathname: string): Promise<Uint8Array> {
  const stream = await readFile(pathname);
  if (!stream) throw new GenerationFailed("missing_file", `Missing file ${pathname}`);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A photo of a plan, at most 2000 px on its longest side, as JPEG. */
async function planImage(bytes: Uint8Array): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  const jpeg = await sharp(Buffer.from(bytes)).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return new Uint8Array(jpeg);
}

/** Step 0. */
export async function prepareInputs(generationId: string) {
  const row = await load(generationId);
  if (row.state.inputs) return;
  await log(generationId, { step: 0, kind: "info", code: "reading" });
  const docs = await budgetInputs(row.tenantId, row.projectId, row.documentIds);
  if (docs.length === 0) throw new GenerationFailed("no_documents");

  const files: InputFile[] = [];
  const measurements: string[] = [];
  for (const doc of docs) {
    const kind = doc.budgetInput!;
    const title = `${INPUT_LABELS[kind]} · ${doc.title}`;
    const extension = (doc.filename ?? doc.pathname).toLowerCase().split(".").pop();
    const pdf = doc.contentType === "application/pdf";
    if (pdf || doc.contentType.startsWith("image/")) {
      // Uploaded once per document; a retry or a second run reuses the file.
      let fileId = doc.claudeFileId;
      if (!fileId) {
        const bytes = await readBytes(doc.pathname);
        fileId = pdf
          ? await uploadFile(`${doc.title}.pdf`, bytes, "application/pdf")
          : await uploadFile(`${doc.title}.jpg`, await planImage(bytes), "image/jpeg");
        await setClaudeFileId(doc.id, fileId);
      }
      files.push({ documentId: doc.id, kind, title, fileId, type: pdf ? "document" : "image" });
    } else if (extension === "bc3") {
      measurements.push(measurementText(parseBc3(await readBytes(doc.pathname))));
    } else if (extension === "xlsx") {
      measurements.push(await parseXlsx(await readBytes(doc.pathname)));
    }
  }
  const inputs = { files, measurements: measurements.join("\n\n") };
  await db
    .update(budgetGenerations)
    .set({ state: sql`${budgetGenerations.state} || ${JSON.stringify({ inputs })}::jsonb` })
    .where(eq(budgetGenerations.id, generationId));
  await log(generationId, { step: 0, kind: "done", code: "read", params: { files: docs.length } });
}

/** Step 1. */
export async function extractProject(generationId: string) {
  const row = await load(generationId);
  if (row.extracted) return;
  const inputs = row.state.inputs;
  if (!inputs) throw new GenerationFailed("not_prepared");
  await log(generationId, { step: 1, kind: "info", code: "analysing" });

  // Documents go before the instruction (Claude reads them first).
  const hasMeasurements = Boolean(inputs.measurements) || inputs.files.some((f) => f.kind === "measurements");
  const prompt = extractionPrompt(hasMeasurements);
  const content: ContentBlock[] = [
    ...inputs.files.map((f): ContentBlock =>
      f.type === "document"
        ? { type: "document", source: { type: "file", file_id: f.fileId }, title: f.title }
        : { type: "image", source: { type: "file", file_id: f.fileId } },
    ),
    ...(inputs.measurements ? [{ type: "text" as const, text: `MEDICIONES DEL PROYECTO:\n${inputs.measurements}` }] : []),
    { type: "text", text: prompt.instruction },
  ];
  const extracted = await structuredCall(
    { model: MODELS.reader, system: prompt.system, content, schema: ProjectExtraction, effort: "high" },
    callContext(row, "budget.extract"),
  );
  await db.update(budgetGenerations).set({ extracted }).where(eq(budgetGenerations.id, generationId));
  await log(generationId, {
    step: 1,
    kind: "done",
    code: "analysed",
    params: { builtArea: extracted.datos.m2c, inconsistencies: extracted.incoherencias.length },
  });
}

/** Steps 2–5: one group of chapters (`index` 0–3). */
export async function generateGroup(generationId: string, index: number) {
  const row = await load(generationId);
  if (row.state.groups?.[index]) return;
  const chapters = GROUPS[index];
  if (!chapters || !row.extracted) throw new GenerationFailed("not_prepared");
  const range = { from: chapters[0]!, to: chapters[chapters.length - 1]! };
  await log(generationId, { step: index + 2, kind: "info", code: "group", params: range });

  const { quality } = row.options as GenerationOptions;
  const prompt = groupPrompt(quality, row.extracted, row.state.inputs?.measurements ?? "");
  const result = await structuredCall(
    {
      model: MODELS.writer,
      system: prompt.system,
      // The shared part is cached: every group sends the same prefix.
      content: [
        { type: "text", text: prompt.shared, cache_control: { type: "ephemeral" } },
        { type: "text", text: groupInstruction(chapters) },
      ],
      schema: ChapterLines,
      effort: "medium",
    },
    callContext(row, `budget.group.${index}`),
  );
  const lines = toDraftLines(result, chapters);
  // One statement, so groups finishing at once don't overwrite each other.
  await db
    .update(budgetGenerations)
    .set({
      state: sql`jsonb_set(${budgetGenerations.state}, '{groups}', coalesce(${budgetGenerations.state}->'groups', '{}'::jsonb) || ${JSON.stringify({ [index]: result })}::jsonb)`,
    })
    .where(eq(budgetGenerations.id, generationId));
  const amountCents = lines.reduce((sum, l) => sum + lineAmountCents(l.quantity, l.unitPriceCents), 0);
  await log(generationId, { step: index + 2, kind: "done", code: "grouped", params: { ...range, lines: lines.length, amountCents } });
}

/** Last step: the draft Rev.0. */
export async function saveDraft(generationId: string) {
  const row = await load(generationId);
  const extracted = row.extracted as ProjectExtraction | null;
  const groups = row.state.groups ?? {};
  if (!extracted || GROUPS.some((_, i) => !groups[i])) throw new GenerationFailed("not_prepared");
  const options = row.options as GenerationOptions;
  const texts = toTexts(extracted);
  const notes = chapterNotes(extracted);
  const lines = GROUPS.flatMap((group, i) => toDraftLines(groups[i]!, group));
  const area = (m2: number) => (m2 > 0 ? Math.round(m2 * 100) : null);

  const revisionId = await db.transaction(async (tx) => {
    await lockForFirstBudget(tx, row.projectId);
    const { revisionId, contingencyBp, chapterIds } = await insertFramerRevision(tx, row.tenantId, row.projectId, {
      reference: options.reference,
      number: 0,
      quality: options.quality,
      vatRateBp: options.vatRateBp,
      builtAreaCm2: area(extracted.datos.m2c),
      usefulAreaCm2: area(extracted.datos.m2u),
      texts,
      generationId,
    }, notes);
    const positions = new Map<string, number>();
    const values = lines.map(({ chapter, quantity, ...line }) => {
      const position = positions.get(chapter) ?? 0;
      positions.set(chapter, position + 1);
      return { ...line, tenantId: row.tenantId, chapterId: chapterIds.get(chapter)!, quantityMilli: Math.round(quantity * 1000), position };
    });
    if (values.length > 0) await tx.insert(budgetLines).values(values);
    await syncDraft(tx, revisionId, { tenantId: row.tenantId, contingencyBp });
    await tx
      .update(budgetGenerations)
      .set({ status: "succeeded", revisionId, step: 5 })
      .where(eq(budgetGenerations.id, generationId));
    return revisionId;
  });
  await log(generationId, { step: 5, kind: "done", code: "saved", params: { lines: lines.length } });
  // The app shows the new hitos.
  await markChanged(row.tenantId, row.projectId, ["obra"]);
  return { revisionId };
}

/** Whether no retry can fix the error: the run ends there. */
export function isFinal(error: unknown) {
  return (
    error instanceof GenerationStopped ||
    error instanceof GenerationFailed ||
    error instanceof ClaudeError ||
    error instanceof CoreError
  );
}

/** Why a step failed, as the code the portal words (and a message for the log). */
export function failureOf(error: unknown): { code: string; message: string } {
  if (error instanceof GenerationFailed) return { code: error.code, message: error.message };
  if (error instanceof ClaudeError || error instanceof CoreError) return { code: error.code, message: error.message };
  return { code: "unexpected", message: error instanceof Error ? error.message : String(error) };
}

/** Records a failed generation (unless it was cancelled meanwhile). */
export async function failGeneration(generationId: string, code: string, message: string) {
  const [row] = await db
    .update(budgetGenerations)
    .set({ status: "failed", error: code })
    .where(and(eq(budgetGenerations.id, generationId), inArray(budgetGenerations.status, ACTIVE_GENERATION_STATUSES)))
    .returning({ step: budgetGenerations.step });
  if (row) await log(generationId, { step: row.step, kind: "error", code, params: { message: message.slice(0, 300) } });
}
