import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiUsage, budgetGenerations, db, eq, projectDocuments, tenants } from "@repo/db";
import { createTestDocument, createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { budgetGenerationsService as svc, budgetService, type Ctx } from "../src";
import * as claude from "../src/budget-ai/claude";
import { measurementText, parseBc3, parseXlsx } from "../src/budget-ai/measurements";
import {
  extractProject,
  failGeneration,
  failureOf,
  generateGroup,
  GenerationStopped,
  prepareInputs,
  saveDraft,
} from "../src/budget-ai/pipeline";
import { toDraftLines } from "../src/budget-ai/postprocess";
import type { ChapterLines, ProjectExtraction } from "../src/budget-ai/schemas";
import { files } from "../src/testing";

vi.mock("../src/storage", () => import("../src/testing"));
vi.mock("../src/budget-ai/claude", async (importActual) => ({
  ...(await importActual<typeof import("../src/budget-ai/claude")>()),
  uploadFile: vi.fn(async (name: string) => `file_${name}`),
  structuredCall: vi.fn(),
}));

const EXTRACTION: ProjectExtraction = {
  datos: { cliente: "D. Roberto Guzmán Mesa", ubicacion: "C/ de la Arboleda 3", municipio: "Zarzalejo", provincia: "Madrid", refCatastral: "", arquitecto: "Zeltia González Blanco", tipologia: "Unifamiliar aislada", plantas: 2, m2c: 184.91, m2u: 139.7, parcela: 0 },
  superficies: { planta: [{ nombre: "Baja", m2c: 113 }], fachada: 256, huecos: 36, cubierta: 128, perimetro: 50, forjados: 140, terrazas: 40.5 },
  recuento: { ventanas: 14, puertasExt: 2, puertasInt: 9, banos: 3, aseos: 0, dormitorios: 2 },
  sistema: "Muros de termoarcilla y SATE",
  mediciones: [{ concepto: "Fachada", ud: "m2", cantidad: 256, fuente: "plano" }],
  incoherencias: [{ titulo: "Carga de nieve", texto: "57 kg/m² en E1 y 1,55 kN/m² en E4" }],
  supuestos: [{ titulo: "Parcela", texto: "Sin superficie" }],
  portada: { programa: "Salón, cocina", base: "Proyecto de Ejecución", alcance: "Llave en mano", sistemaConstructivo: "Steel Frame" },
  justificacion: { intro: "El proyecto se adapta", apartados: [{ titulo: "Estructura vertical.", texto: "Muros C150" }] },
  criterioMedicion: "Sobre el BC3",
  notasCapitulo: [{ cod: "3", nota: "Sustituye a los muros de termoarcilla" }, { cod: "20", nota: "Ignored" }],
  noIncluido: ["Estudio geotécnico definitivo."],
};

const partida = (cod: string, med: number, pu: number, fuente: "base" | "estimado" = "base") => ({ cod, desc: `Partida ${cod}`, ud: "m2", med, pu, fuente, nota: "" });

/** Each group's answer: one line per chapter (10 € × chapter number) and one dropped. */
function groupAnswer(chapters: readonly string[]): ChapterLines {
  return {
    capitulos: chapters.map((cod, i) => ({
      cod,
      partidas: [partida(`${cod}.01`, 1, Number(cod) * 10, i === 0 ? "estimado" : "base"), partida(`${cod}.02`, 0, 5)],
    })),
  };
}

function fakeClaude() {
  vi.mocked(claude.structuredCall).mockImplementation(async (options, context) => {
    await db.insert(aiUsage).values({ tenantId: context.tenantId, purpose: context.purpose, model: options.model, inputTokens: 1000, outputTokens: 100, costMicroUsd: 6_000 });
    if (context.purpose === "budget.extract") return EXTRACTION as never;
    const text = options.content.map((b) => ("text" in b ? b.text : "")).join("\n");
    const chapters = /capítulos (.+?)\./.exec(text)![1]!.split("; ").map((c) => c.slice(0, 2));
    return groupAnswer(chapters) as never;
  });
}

async function setup(role: Ctx["role"] = "admin") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const project = await createTestProject(tenant.id);
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  const plans = await createTestDocument(tenant.id, project.id, { title: "Planos", category: "budget", budgetInput: "plans", visibleToClient: false });
  files.set(plans.pathname, new Blob(["%PDF-1.7 planos"]));
  const bc3 = await createTestDocument(tenant.id, project.id, {
    title: "Mediciones",
    category: "budget",
    budgetInput: "measurements",
    visibleToClient: false,
    filename: "mediciones.bc3",
    contentType: "application/octet-stream",
    pathname: `tenants/${tenant.id}/projects/${project.id}/inputs/m.bc3`,
  });
  files.set(bc3.pathname, new Blob([BC3]));
  return { tenant, project, ctx, documentIds: [plans.id, bc3.id] };
}

const BC3 = [
  "~V|SOFT|FIEBDC-3/2016|ANSI|",
  "~C|OBRA##||Vivienda Arboleda|0|",
  "~C|01#||Movimiento de tierras|0|",
  "~C|01.01|m3|Excavación en zanjas|0|",
  "~C|01.02|m3|Transporte a vertedero|0|",
  "~D|OBRA##|01#\\1\\1\\|",
  "~D|01#|01.01\\1\\3.06\\01.02\\1\\75\\|",
  "~M|01#\\01.01|1|3.10|",
].join("\r\n");

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(claude.structuredCall).mockReset();
  vi.mocked(claude.uploadFile).mockClear();
});

describe("startGeneration", () => {
  it("queues a run over the project's budget documents", async () => {
    const { project, ctx, documentIds } = await setup();

    const { generationId } = await svc.startGeneration(ctx, project.id, { documentIds, reference: "041/2026", quality: "project" });

    expect(await svc.getGeneration(ctx, project.id, generationId)).toMatchObject({ status: "queued", step: 0, log: [], facts: null });
    expect((await budgetService.getBudget(ctx, project.id)).generation?.id).toBe(generationId);
    const [row] = await db.select().from(budgetGenerations).where(eq(budgetGenerations.id, generationId));
    expect(row).toMatchObject({ options: { reference: "041/2026", quality: "project", vatRateBp: 1000 }, documentIds });
  });

  it("needs budget documents, no budget yet, one run at a time and the AI limit not reached", async () => {
    const { tenant, project, ctx, documentIds } = await setup();
    const contract = await createTestDocument(tenant.id, project.id);

    await expect(svc.startGeneration(ctx, project.id, { documentIds: [] })).rejects.toMatchObject({ code: "no_documents" });
    await expect(svc.startGeneration(ctx, project.id, { documentIds: [contract.id] })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.startGeneration(ctx, project.id, { documentIds, quality: "gold" })).rejects.toMatchObject({ code: "invalid_input" });
    await svc.startGeneration(ctx, project.id, { documentIds });
    await expect(svc.startGeneration(ctx, project.id, { documentIds })).rejects.toMatchObject({ code: "generation_running", status: 409 });

    const second = await setup();
    await budgetService.createBudget(second.ctx, second.project.id, {});
    await expect(svc.startGeneration(second.ctx, second.project.id, { documentIds: second.documentIds })).rejects.toMatchObject({ code: "budget_exists" });

    const third = await setup();
    await db.update(tenants).set({ aiMonthlyLimitCents: 500 }).where(eq(tenants.id, third.tenant.id));
    await db.insert(aiUsage).values({ tenantId: third.tenant.id, purpose: "x", model: "m", inputTokens: 1, outputTokens: 1, costMicroUsd: 5_000_000 });
    await expect(svc.startGeneration(third.ctx, third.project.id, { documentIds: third.documentIds })).rejects.toMatchObject({ code: "ai_limit_reached", status: 429 });
  });

  it("is for editors, within their tenant", async () => {
    const { project, ctx, documentIds } = await setup();
    const other = await setup();
    await expect(svc.startGeneration({ ...ctx, role: "viewer" }, project.id, { documentIds })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.startGeneration(other.ctx, other.project.id, { documentIds })).rejects.toMatchObject({ code: "not_found" });
    const { generationId } = await svc.startGeneration(ctx, project.id, { documentIds });
    await expect(svc.getGeneration(other.ctx, other.project.id, generationId)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.cancelGeneration(other.ctx, project.id, generationId)).rejects.toMatchObject({ code: "project_not_found" });
  });
});

describe("pipeline", () => {
  async function run(generationId: string) {
    await prepareInputs(generationId);
    await extractProject(generationId);
    for (const index of [0, 1, 2, 3]) await generateGroup(generationId, index);
    return saveDraft(generationId);
  }

  it("drafts Rev.0 from the documents: lines, chapter 20, texts and notes", async () => {
    fakeClaude();
    const { project, ctx, documentIds } = await setup();
    const { generationId } = await svc.startGeneration(ctx, project.id, { documentIds, reference: "041/2026" });

    const { revisionId } = await run(generationId);

    const { revision, generation } = await budgetService.getBudget(ctx, project.id);
    expect(revision).toMatchObject({ id: revisionId, number: 0, status: "draft", reference: "041/2026", builtAreaM2: 184.91, usefulAreaM2: 139.7 });
    // One line per chapter 01–19 at 10 € × its number, the zero-quantity ones dropped.
    const lines = revision!.chapters.slice(0, 19).flatMap((c) => c.lines);
    expect(lines).toHaveLength(19);
    expect(lines[0]).toMatchObject({ code: "01.01", unitPriceCents: 1_000, source: "estimated" });
    expect(lines[1]).toMatchObject({ code: "02.01", source: "base", baseCode: "02.01" });
    expect(revision!.totalCents).toBe(190_00 * 10 + 9_500);
    expect(revision!.chapters[2]!.pdfNote).toBe("Sustituye a los muros de termoarcilla");
    expect(revision!.texts).toMatchObject({
      cover: { promoter: "D. Roberto Guzmán Mesa", site: "C/ de la Arboleda 3, Zarzalejo (Madrid)", surfaces: "184,91 m² construidos · 139,7 m² útiles · terrazas 40,5 m²" },
      justification: { blocks: [{ title: "Estructura vertical", text: "Muros C150" }] },
      measurementCriterion: "Sobre el BC3",
      exclusions: ["Estudio geotécnico definitivo."],
    });
    const estimated = revision!.chapters[0]!.lines.find((l) => l.code === "01.01")!;
    expect(revision!.checks.map((c) => c.key)).toEqual(expect.arrayContaining(["annex:i1", "annex:s1", `line:${estimated.lineageId}`]));
    expect(generation).toMatchObject({ status: "succeeded", step: 5, revisionId, facts: { builtAreaM2: 184.91, bathrooms: 3, inconsistencies: ["Carga de nieve"] } });
    expect(generation!.log.map((l) => l.code)).toEqual(["reading", "read", "analysing", "analysed", "group", "grouped", "group", "grouped", "group", "grouped", "group", "grouped", "saved"]);
  });

  it("sends the PDFs once through the Files API and the BC3 as text", async () => {
    fakeClaude();
    const { project, ctx, documentIds } = await setup();
    const { generationId } = await svc.startGeneration(ctx, project.id, { documentIds });

    await prepareInputs(generationId);
    await extractProject(generationId);

    expect(claude.uploadFile).toHaveBeenCalledTimes(1);
    const [options] = vi.mocked(claude.structuredCall).mock.calls[0]!;
    expect(options.content[0]).toMatchObject({ type: "document", source: { type: "file", file_id: "file_Planos.pdf" }, title: "Planos · Planos" });
    expect(options.content.map((b) => ("text" in b ? b.text : "")).join("\n")).toContain("01.01 | Excavación en zanjas | m3 | 3.1");
    expect(options.model).toBe("claude-opus-5-5");
    // The file id is kept for the next generation.
    const [plans] = await db.select().from(projectDocuments).where(eq(projectDocuments.id, documentIds[0]!));
    expect(plans!.claudeFileId).toBe("file_Planos.pdf");
  });

  it("retries a step without calling Claude again for work already done", async () => {
    fakeClaude();
    const { project, ctx, documentIds } = await setup();
    const { generationId } = await svc.startGeneration(ctx, project.id, { documentIds });
    await prepareInputs(generationId);
    await extractProject(generationId);
    await generateGroup(generationId, 0);

    await extractProject(generationId);
    await generateGroup(generationId, 0);

    expect(claude.structuredCall).toHaveBeenCalledTimes(2);
    expect(await db.select().from(aiUsage)).toHaveLength(2);
  });

  it("records a failure in words the portal can show, and stops when cancelled", async () => {
    vi.mocked(claude.structuredCall).mockRejectedValue(new claude.ClaudeError("refused", "Declined"));
    const { project, ctx, documentIds } = await setup();
    const { generationId } = await svc.startGeneration(ctx, project.id, { documentIds });
    await prepareInputs(generationId);

    const error = await extractProject(generationId).catch((e: unknown) => e);
    const { code, message } = failureOf(error);
    await failGeneration(generationId, code, message);

    expect(await svc.getGeneration(ctx, project.id, generationId)).toMatchObject({ status: "failed", error: "refused" });
    // A new run may start after a failure.
    const { generationId: next } = await svc.startGeneration(ctx, project.id, { documentIds });
    expect(await svc.cancelGeneration(ctx, project.id, next)).toEqual({ generationId: next, workflowRunId: null });
    await expect(prepareInputs(next)).rejects.toBeInstanceOf(GenerationStopped);
    await failGeneration(next, "unexpected", "late");
    expect((await svc.getGeneration(ctx, project.id, next)).status).toBe("cancelled");
  });

  it("won't overwrite a budget made meanwhile", async () => {
    fakeClaude();
    const { project, ctx, documentIds } = await setup();
    const { generationId } = await svc.startGeneration(ctx, project.id, { documentIds });
    await prepareInputs(generationId);
    await extractProject(generationId);
    for (const index of [0, 1, 2, 3]) await generateGroup(generationId, index);
    await budgetService.createBudget(ctx, project.id, {});

    await expect(saveDraft(generationId)).rejects.toMatchObject({ code: "budget_exists" });
  });
});

describe("post-processing", () => {
  it("drops lines without quantity or price and codes outside the group", () => {
    const lines = toDraftLines(
      {
        capitulos: [
          { cod: "1", partidas: [partida("01.01", 2.12345, 10.005), partida("01.02", 1, 0), { ...partida("", 1, 1), desc: "Sin código" }] },
          { cod: "07", partidas: [partida("07.01", 1, 1)] },
        ],
      },
      ["01", "02"],
    );
    expect(lines.map((l) => [l.chapter, l.code, l.quantity, l.unitPriceCents, l.baseCode])).toEqual([
      ["01", "01.01", 2.123, 1001, "01.01"],
      ["01", "01.03", 1, 100, null],
    ]);
  });
});

describe("measurements", () => {
  it("reads a BC3's measured quantities, falling back to the yields", () => {
    const rows = parseBc3(new TextEncoder().encode(BC3));
    expect(rows).toEqual([
      { chapter: "Movimiento de tierras", code: "01.01", description: "Excavación en zanjas", unit: "m3", quantity: 3.1 },
      { chapter: "Movimiento de tierras", code: "01.02", description: "Transporte a vertedero", unit: "m3", quantity: 75 },
    ]);
    expect(measurementText(rows)).toBe("## Movimiento de tierras\n01.01 | Excavación en zanjas | m3 | 3.1\n01.02 | Transporte a vertedero | m3 | 75");
  });

  it("takes an empty BC3 factor as 1", () => {
    const bc3 = "~C|ROOT##||Obra|\n~C|01#||Cimentación|\n~C|01.01|m3|Hormigón|\n~D|ROOT##|01#\\1\\|\n~D|01#|01.01\\\\25.5\\|\n";
    expect(parseBc3(new TextEncoder().encode(bc3))).toEqual([
      { chapter: "Cimentación", code: "01.01", description: "Hormigón", unit: "m3", quantity: 25.5 },
    ]);
  });

  it("reads each sheet of a workbook", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Mediciones");
    sheet.addRow(["Código", "Concepto", "Ud", "Cantidad"]);
    sheet.addRow(["01.01", "Excavación", "m3", 3.06]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());

    expect(await parseXlsx(bytes)).toBe("## Mediciones\nCódigo | Concepto | Ud | Cantidad\n01.01 | Excavación | m3 | 3.06");
  });
});
