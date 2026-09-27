import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { budgetService, hitosService as svc, MAX_DOCUMENT_BYTES, type Ctx, type Hito } from "../src";
import { files } from "../src/testing";

vi.mock("../src/storage", () => import("../src/testing"));

const pdf = (text = "%PDF-1.7 acta") => new File([text], "acta.pdf", { type: "application/pdf" });

/** A project with a client, an accepted budget of 01–05 (1.000 € each) and its hitos. */
async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  const { revisionId } = await budgetService.createBudget(ctx, project.id, {});
  for (const code of ["01", "02", "03", "04", "05"]) {
    const { chapterId } = await budgetService.addChapter(ctx, project.id, revisionId, { code, name: `Capítulo ${code}` });
    await budgetService.addLine(ctx, project.id, chapterId, {
      code: `${code}.01`,
      description: "Partida",
      unit: "pa",
      quantity: 1,
      unitPriceCents: 100_000,
    });
  }
  await budgetService.acceptRevision(ctx, project.id, revisionId);
  const hitos = await svc.listHitos(ctx, project.id);
  const byCode = (code: string) => hitos.find((h) => h.code === code)!;
  return { tenant, client, project, ctx, byCode };
}

async function progress(ctx: Ctx, projectId: string, pctByChapter: Record<string, number>) {
  const { revision } = await budgetService.getBudget(ctx, projectId);
  const lines = revision!.chapters.flatMap((c) =>
    c.code in pctByChapter ? [{ id: c.lines[0]!.id, executedPct: pctByChapter[c.code]! }] : [],
  );
  await budgetService.setProgress(ctx, projectId, { lines });
}

const find = async (ctx: Ctx, projectId: string, code: string): Promise<Hito> =>
  (await svc.listHitos(ctx, projectId)).find((h) => h.code === code)!;

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("listHitos", () => {
  it("prices each hito from the accepted budget, with VAT", async () => {
    const { byCode } = await setup();
    // 5 % and 12 % of 5.000 €.
    expect(byCode("H0")).toMatchObject({ name: "Señal de reserva", amountCents: 25_000, vatCents: 2_500, status: "pending" });
    expect(byCode("H2")).toMatchObject({ pctBp: 1200, amountCents: 60_000 });
  });

  it("maps the standard chapters and checks", async () => {
    const { byCode } = await setup();
    // The budget has 01–05; the template's other chapters are mapped but absent.
    expect(byCode("H2").chapters.map((c) => c.code)).toEqual(["01", "02", "03"]);
    expect(byCode("H4").chapters.map((c) => c.code)).toEqual(["05"]);
    expect(byCode("H4").checks.map((c) => c.label)).toEqual(["Prueba de estanqueidad provisional"]);
    expect(byCode("H9").checks).toHaveLength(9);
  });

  it("follows the chapters' progress", async () => {
    const { project, ctx } = await setup();

    await progress(ctx, project.id, { "01": 100, "02": 100, "03": 40 });
    expect(await find(ctx, project.id, "H2")).toMatchObject({ status: "active", readyPct: 80 });

    await progress(ctx, project.id, { "03": 100 });
    expect(await find(ctx, project.id, "H2")).toMatchObject({ status: "ready", readyPct: 100 });
  });
});

describe("updateHito", () => {
  it("edits the plan and moves chapters between hitos", async () => {
    const { project, ctx, byCode } = await setup();

    await svc.updateHito(ctx, project.id, byCode("H3").id, {
      name: "Estructura",
      pctBp: 1600,
      scope: "Muros y forjados",
      billingMoment: "Estructura levantada",
      chapterCodes: ["04", "03"],
    });

    expect(await find(ctx, project.id, "H3")).toMatchObject({
      name: "Estructura",
      pctBp: 1600,
      amountCents: 80_000,
      scope: "Muros y forjados",
      chapters: [expect.objectContaining({ code: "03" }), expect.objectContaining({ code: "04" })],
    });
    expect((await find(ctx, project.id, "H2")).chapters.map((c) => c.code)).toEqual(["01", "02"]);
  });

  it("validates", async () => {
    const { project, ctx, byCode } = await setup();
    await expect(svc.updateHito(ctx, project.id, byCode("H3").id, { pctBp: 10_001 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.updateHito(ctx, project.id, byCode("H3").id, { name: "" })).rejects.toMatchObject({ code: "missing_fields" });
  });
});

describe("checks", () => {
  it("adds, ticks and removes checks; a hito is ready once they are done", async () => {
    const { project, ctx, byCode } = await setup();
    await progress(ctx, project.id, { "05": 100 });
    const h4 = byCode("H4");
    expect((await find(ctx, project.id, "H4")).status).toBe("active");

    await svc.updateCheck(ctx, project.id, h4.checks[0]!.id, { done: true });
    expect((await find(ctx, project.id, "H4")).status).toBe("ready");

    const { checkId } = await svc.addCheck(ctx, project.id, h4.id, { label: "Persianas motorizadas" });
    expect((await find(ctx, project.id, "H4")).status).toBe("active");
    await svc.deleteCheck(ctx, project.id, checkId);
    expect((await find(ctx, project.id, "H4")).checks.map((c) => c.label)).toEqual(["Prueba de estanqueidad provisional"]);
  });
});

describe("acta, invoice and payment", () => {
  it("records the signed acta, the invoice and the payment", async () => {
    const { project, ctx, byCode } = await setup();
    const h3 = byCode("H3");
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-24T10:00:00Z") });
    try {
      await svc.uploadHitoFile(ctx, project.id, h3.id, "acta", { file: pdf(), date: "2026-09-24" });
      expect(await find(ctx, project.id, "H3")).toMatchObject({ status: "signed", actaSignedOn: "2026-09-24", dueOn: "2026-10-01" });

      await svc.uploadHitoFile(ctx, project.id, h3.id, "invoice", { file: pdf("%PDF-factura") });
      expect(await find(ctx, project.id, "H3")).toMatchObject({ status: "invoiced", invoicedOn: "2026-09-24" });

      await svc.registerPayment(ctx, project.id, h3.id, { paidOn: "2026-09-30" });
      // Defaults to the amount with VAT.
      expect(await find(ctx, project.id, "H3")).toMatchObject({ status: "paid", paidOn: "2026-09-30", paidAmountCents: 82_500 });

      await svc.cancelPayment(ctx, project.id, h3.id);
      expect((await find(ctx, project.id, "H3")).status).toBe("invoiced");
    } finally {
      vi.useRealTimers();
    }

    const file = await svc.openHitoFile(ctx, project.id, h3.id, "invoice");
    expect(await new Response(file.body).text()).toBe("%PDF-factura");
    expect(file).toMatchObject({ contentType: "application/pdf", filename: "Factura H3.pdf" });
  });

  it("replaces and removes a file", async () => {
    const { project, ctx, byCode } = await setup();
    const h3 = byCode("H3");
    await svc.uploadHitoFile(ctx, project.id, h3.id, "acta", { file: pdf("%PDF-1"), date: "2026-09-24" });
    await svc.uploadHitoFile(ctx, project.id, h3.id, "acta", { file: pdf("%PDF-2"), date: "2026-09-25" });

    expect(files.size).toBe(1);
    expect(await new Response((await svc.openHitoFile(ctx, project.id, h3.id, "acta")).body).text()).toBe("%PDF-2");

    await svc.removeHitoFile(ctx, project.id, h3.id, "acta");
    expect(files.size).toBe(0);
    expect(await find(ctx, project.id, "H3")).toMatchObject({ actaSignedOn: null, status: "pending" });
    await expect(svc.openHitoFile(ctx, project.id, h3.id, "acta")).rejects.toMatchObject({ code: "not_found" });
  });

  it("validates files and dates", async () => {
    const { project, ctx, byCode } = await setup();
    const id = byCode("H3").id;
    await expect(svc.uploadHitoFile(ctx, project.id, id, "acta", { file: pdf() })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(svc.uploadHitoFile(ctx, project.id, id, "acta", { date: "2026-09-24" })).rejects.toMatchObject({ code: "missing_file" });
    await expect(svc.uploadHitoFile(ctx, project.id, id, "acta", { file: new File(["hola"], "x.pdf"), date: "2026-09-24" })).rejects.toMatchObject({ code: "invalid_file_type" });
    const big = new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], "x.pdf");
    await expect(svc.uploadHitoFile(ctx, project.id, id, "acta", { file: big, date: "2026-09-24" })).rejects.toMatchObject({ code: "file_too_large" });
    await expect(svc.registerPayment(ctx, project.id, id, { paidOn: "30/09/2026" })).rejects.toMatchObject({ code: "invalid_date" });
  });

  it("picks the acta's photos from the project's own photos", async () => {
    const { tenant, project, ctx, byCode } = await setup();
    const a = await createTestPhoto(tenant.id, project.id);
    const b = await createTestPhoto(tenant.id, project.id);
    const other = await createTestProject(tenant.id);
    const foreign = await createTestPhoto(tenant.id, other.id);
    const h3 = byCode("H3");

    await svc.setActaPhotos(ctx, project.id, h3.id, { photoIds: [a.id, b.id] });
    expect(new Set((await find(ctx, project.id, "H3")).photoIds)).toEqual(new Set([a.id, b.id]));

    await expect(svc.setActaPhotos(ctx, project.id, h3.id, { photoIds: [foreign.id] })).rejects.toMatchObject({ code: "not_found" });
    await svc.setActaPhotos(ctx, project.id, h3.id, { photoIds: [] });
    expect((await find(ctx, project.id, "H3")).photoIds).toEqual([]);
  });
});

describe("access", () => {
  it("lets viewers read but not change", async () => {
    const { tenant, project, byCode } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const vctx: Ctx = { tenantId: tenant.id, userId: viewer.id, role: "viewer" };

    expect(await svc.listHitos(vctx, project.id)).toHaveLength(10);
    await expect(svc.registerPayment(vctx, project.id, byCode("H0").id, { paidOn: "2026-02-03" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps tenants apart", async () => {
    const { project, byCode } = await setup();
    const other = await setup();

    await expect(svc.listHitos(other.ctx, project.id)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.updateHito(other.ctx, other.project.id, byCode("H3").id, { name: "X" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("serves a client only their own project's files", async () => {
    const { tenant, client, project, ctx, byCode } = await setup();
    await svc.uploadHitoFile(ctx, project.id, byCode("H3").id, "invoice", { file: pdf("%PDF-mine") });
    const other = await setup();
    await svc.uploadHitoFile(other.ctx, other.project.id, other.byCode("H3").id, "invoice", { file: pdf() });

    const mine = await svc.openClientHitoFile(tenant.id, client.id, byCode("H3").id, "invoice");
    expect(await new Response(mine.body).text()).toBe("%PDF-mine");
    await expect(svc.openClientHitoFile(tenant.id, client.id, other.byCode("H3").id, "invoice")).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.openClientHitoFile(tenant.id, client.id, byCode("H3").id, "acta")).rejects.toMatchObject({ code: "not_found" });
  });
});
