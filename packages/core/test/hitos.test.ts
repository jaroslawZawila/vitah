import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { asc, db, eq, obraHitoEvents, users } from "@repo/db";
import { budgetService, hitosService as svc, MAX_DOCUMENT_BYTES, photosService, type Ctx, type Hito } from "../src";
import { framerDraft } from "./budget-fixture";
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
  const { revisionId } = await framerDraft(ctx, project.id, ["01", "02", "03", "04", "05"]);
  // No contingency, so the hitos share exactly 5.000 €.
  await budgetService.updateRevision(ctx, project.id, revisionId, { contingencyPct: 0 });
  await budgetService.acceptRevision(ctx, project.id, revisionId, {}, { unissued: true });
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

/** A hito's history as stored (pathnames and all), oldest first. */
const stored = (hitoId: string) =>
  db.select().from(obraHitoEvents).where(eq(obraHitoEvents.hitoId, hitoId)).orderBy(asc(obraHitoEvents.createdAt));

const text = (file: Blob | undefined) => file?.text();

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
    // Only chapters with lines show: the template maps 06 and 10 to H4 too.
    expect(byCode("H2").chapters.map((c) => c.code)).toEqual(["01", "02"]);
    expect(byCode("H4").chapters.map((c) => c.code)).toEqual(["05"]);
    expect(byCode("H4").checks.map((c) => c.label)).toEqual(["Prueba de estanqueidad provisional"]);
    expect(byCode("H9").checks).toHaveLength(9);
  });

  it("follows the chapters' progress", async () => {
    const { project, ctx } = await setup();

    await progress(ctx, project.id, { "01": 100, "02": 60 });
    expect(await find(ctx, project.id, "H2")).toMatchObject({ status: "active", readyPct: 80 });

    await progress(ctx, project.id, { "02": 100 });
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

describe("updatePlan", () => {
  it("saves every hito's % and chapters in one go", async () => {
    const { project, ctx, byCode } = await setup();

    await svc.updatePlan(ctx, project.id, {
      hitos: [
        { id: byCode("H3").id, pctBp: 1400, chapterCodes: ["03", "04"] },
        { id: byCode("H4").id, pctBp: 1400 },
      ],
    });

    const hitos = await svc.listHitos(ctx, project.id);
    const get = (code: string) => hitos.find((h) => h.code === code)!;
    expect(get("H3")).toMatchObject({ pctBp: 1400, chapters: [{ code: "03" }, { code: "04" }] });
    expect(get("H2").chapters.map((c) => c.code)).toEqual(["01", "02"]);
    expect(get("H4")).toMatchObject({ pctBp: 1400, chapters: [{ code: "05" }] });
  });

  it("only takes chapter codes the budget has", async () => {
    const { project, ctx, byCode } = await setup();
    await expect(svc.updatePlan(ctx, project.id, { hitos: [{ id: byCode("H4").id, chapterCodes: ["5"] }] })).rejects.toMatchObject({ code: "unknown_chapter", status: 400 });
    await expect(svc.updateHito(ctx, project.id, byCode("H4").id, { chapterCodes: ["05", "99"] })).rejects.toMatchObject({ code: "unknown_chapter" });
    expect((await find(ctx, project.id, "H4")).chapters.map((c) => c.code)).toEqual(["05"]);
  });

  it("saves nothing when one change is invalid", async () => {
    const { project, ctx, byCode } = await setup();

    await expect(
      svc.updatePlan(ctx, project.id, {
        hitos: [
          { id: byCode("H3").id, pctBp: 1400 },
          { id: byCode("H4").id, pctBp: -1 },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.updatePlan(ctx, project.id, { hitos: [{ id: "nope", pctBp: 100 }] })).rejects.toMatchObject({ code: "not_found" });
    expect((await find(ctx, project.id, "H3")).pctBp).toBe(1500);
  });
});

describe("getHito", () => {
  it("gives one hito of the project", async () => {
    const { project, ctx, byCode } = await setup();
    expect(await svc.getHito(ctx, project.id, byCode("H4").id)).toMatchObject({ code: "H4", totalCents: 71_500 });
    await expect(svc.getHito(ctx, project.id, "nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("checks", () => {
  it("finds a check only under its own hito when one is given", async () => {
    const { project, ctx, byCode } = await setup();
    const check = byCode("H4").checks[0]!;
    await expect(svc.updateCheck(ctx, project.id, check.id, { done: true }, byCode("H5").id)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.deleteCheck(ctx, project.id, check.id, byCode("H5").id)).rejects.toMatchObject({ code: "not_found" });
    await svc.updateCheck(ctx, project.id, check.id, { done: true }, byCode("H4").id);
    expect((await find(ctx, project.id, "H4")).checks[0]?.done).toBe(true);
  });

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

      await svc.registerPayment(ctx, project.id, h3.id, { paidOn: "2026-09-24" });
      // Defaults to the amount with VAT.
      expect(await find(ctx, project.id, "H3")).toMatchObject({ status: "paid", paidOn: "2026-09-24", paidAmountCents: 82_500 });

      await svc.cancelPayment(ctx, project.id, h3.id);
      expect((await find(ctx, project.id, "H3")).status).toBe("invoiced");
    } finally {
      vi.useRealTimers();
    }

    const file = await svc.openHitoFile(ctx, project.id, h3.id, "invoice");
    expect(await new Response(file.body).text()).toBe("%PDF-factura");
    expect(file).toMatchObject({ contentType: "application/pdf", filename: "Factura H3.pdf" });
  });

  it("replaces and removes a file, keeping every PDF in storage", async () => {
    const { project, ctx, byCode } = await setup();
    const h3 = byCode("H3");
    await svc.uploadHitoFile(ctx, project.id, h3.id, "acta", { file: pdf("%PDF-1"), date: "2026-09-24" });
    await svc.uploadHitoFile(ctx, project.id, h3.id, "acta", { file: pdf("%PDF-2 bis"), date: "2026-09-25" });

    expect(await new Response((await svc.openHitoFile(ctx, project.id, h3.id, "acta")).body).text()).toBe("%PDF-2 bis");
    const [first, second] = await stored(h3.id);
    expect(first).toMatchObject({ action: "acta_uploaded", userId: ctx.userId, tenantId: ctx.tenantId, projectId: project.id });
    expect(first!.detail).toEqual({ date: "2026-09-24", sizeBytes: 6, pathname: expect.any(String), previous: null });
    expect(second).toMatchObject({ action: "acta_uploaded", userId: ctx.userId });
    expect(second!.detail).toEqual({
      date: "2026-09-25",
      sizeBytes: 10,
      pathname: expect.any(String),
      previous: { date: "2026-09-24", sizeBytes: 6, pathname: first!.detail.pathname },
    });
    // The acta that was replaced is still there.
    expect(files.size).toBe(2);
    expect(await text(files.get(first!.detail.pathname as string))).toBe("%PDF-1");

    await svc.removeHitoFile(ctx, project.id, h3.id, "acta");
    expect(await find(ctx, project.id, "H3")).toMatchObject({ actaSignedOn: null, status: "pending" });
    await expect(svc.openHitoFile(ctx, project.id, h3.id, "acta")).rejects.toMatchObject({ code: "not_found" });
    // Off the hito, not out of storage.
    expect(files.size).toBe(2);
    expect(await text(files.get(second!.detail.pathname as string))).toBe("%PDF-2 bis");
    const removed = (await stored(h3.id))[2]!;
    expect(removed).toMatchObject({ action: "acta_removed", userId: ctx.userId });
    expect(removed.detail).toEqual({ date: "2026-09-25", sizeBytes: 10, pathname: second!.detail.pathname });

    // Nothing left to remove: nothing logged.
    await svc.removeHitoFile(ctx, project.id, h3.id, "acta");
    expect(await stored(h3.id)).toHaveLength(3);
  });

  it("logs an invoice under its own actions", async () => {
    const { project, ctx, byCode } = await setup();
    const h3 = byCode("H3");
    await svc.uploadHitoFile(ctx, project.id, h3.id, "invoice", { file: pdf("%PDF-factura"), date: "2026-09-26" });
    await svc.removeHitoFile(ctx, project.id, h3.id, "invoice");

    expect((await stored(h3.id)).map((e) => e.action)).toEqual(["invoice_uploaded", "invoice_removed"]);
    expect(files.size).toBe(1);
  });

  it("logs nothing when an upload fails", async () => {
    const { project, ctx, byCode } = await setup();
    const h3 = byCode("H3");
    await expect(svc.uploadHitoFile(ctx, project.id, h3.id, "acta", { file: new File(["hola"], "x.pdf"), date: "2026-09-24" })).rejects.toMatchObject({ code: "invalid_file_type" });
    expect(await stored(h3.id)).toEqual([]);
    expect(files.size).toBe(0);
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

  it("logs a payment registered, corrected and cancelled, with who did it", async () => {
    const { tenant, project, ctx, byCode } = await setup();
    const h3 = byCode("H3");
    const admin = await createTestUser(tenant.id, { role: "admin" });
    const actx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };

    await svc.registerPayment(ctx, project.id, h3.id, { paidOn: "2026-09-30" });
    const [registered, ...none] = await stored(h3.id);
    expect(none).toEqual([]);
    expect(registered).toMatchObject({ action: "payment_registered", userId: ctx.userId, tenantId: tenant.id, projectId: project.id });
    expect(registered!.detail).toEqual({ paidOn: "2026-09-30", amountCents: 82_500, previous: null });

    // A correction keeps what it replaced.
    await svc.registerPayment(actx, project.id, h3.id, { paidOn: "2026-10-02", amountCents: 80_000 });
    expect(await find(ctx, project.id, "H3")).toMatchObject({ paidOn: "2026-10-02", paidAmountCents: 80_000 });
    const corrected = (await stored(h3.id))[1]!;
    expect(corrected).toMatchObject({ action: "payment_registered", userId: admin.id });
    expect(corrected.detail).toEqual({
      paidOn: "2026-10-02",
      amountCents: 80_000,
      previous: { paidOn: "2026-09-30", amountCents: 82_500 },
    });

    await svc.cancelPayment(ctx, project.id, h3.id);
    expect(await find(ctx, project.id, "H3")).toMatchObject({ paidOn: null, paidAmountCents: null });
    const cancelled = (await stored(h3.id))[2]!;
    expect(cancelled).toMatchObject({ action: "payment_cancelled", userId: ctx.userId });
    expect(cancelled.detail).toEqual({ paidOn: "2026-10-02", amountCents: 80_000 });
    expect(await stored(h3.id)).toHaveLength(3);
  });

  it("logs nothing when there is no payment to cancel", async () => {
    const { project, ctx, byCode } = await setup();
    expect(await svc.cancelPayment(ctx, project.id, byCode("H3").id)).toEqual({ hitoId: byCode("H3").id });
    expect(await stored(byCode("H3").id)).toEqual([]);
  });

  it("takes no payment dated after today in Spain, nor one of nothing", async () => {
    const { project, ctx, byCode } = await setup();
    const id = byCode("H3").id;
    // 00:30 of the 25th in Spain, still the 24th in UTC.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-24T22:30:00Z") });
    try {
      await expect(svc.registerPayment(ctx, project.id, id, { paidOn: "2026-09-26" })).rejects.toMatchObject({ code: "invalid_date", status: 400 });
      await expect(svc.registerPayment(ctx, project.id, id, { paidOn: "2026-09-25", amountCents: 0 })).rejects.toMatchObject({ code: "invalid_input", status: 400 });
      await expect(svc.registerPayment(ctx, project.id, id, { paidOn: "2026-09-25", amountCents: -100 })).rejects.toMatchObject({ code: "invalid_input" });
      expect(await stored(id)).toEqual([]);
      expect((await find(ctx, project.id, "H3")).paidOn).toBeNull();

      await svc.registerPayment(ctx, project.id, id, { paidOn: "2026-09-25", amountCents: 1 });
      expect(await find(ctx, project.id, "H3")).toMatchObject({ paidOn: "2026-09-25", paidAmountCents: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("needs the amount for a hito without a price yet", async () => {
    const tenant = await createTestTenant();
    const user = await createTestUser(tenant.id, { role: "manager" });
    const project = await createTestProject(tenant.id);
    const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role: "manager" };
    // A draft only, not accepted: every hito is worth 0 so far.
    await framerDraft(ctx, project.id, ["01"]);
    const h0 = (await svc.listHitos(ctx, project.id)).find((h) => h.code === "H0")!;
    expect(h0.totalCents).toBe(0);

    await expect(svc.registerPayment(ctx, project.id, h0.id, { paidOn: "2026-02-03" })).rejects.toMatchObject({ code: "invalid_input" });
    expect(await stored(h0.id)).toEqual([]);

    await svc.registerPayment(ctx, project.id, h0.id, { paidOn: "2026-02-03", amountCents: 300_000 });
    expect(await find(ctx, project.id, "H0")).toMatchObject({ paidOn: "2026-02-03", paidAmountCents: 300_000 });
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

  it("leaves a deleted photo out of the acta, and doesn't take one", async () => {
    const { tenant, project, ctx, byCode } = await setup();
    const a = await createTestPhoto(tenant.id, project.id);
    const b = await createTestPhoto(tenant.id, project.id);
    const h3 = byCode("H3");
    await svc.setActaPhotos(ctx, project.id, h3.id, { photoIds: [a.id, b.id] });

    await photosService.deletePhoto(ctx, project.id, a.id);

    expect((await find(ctx, project.id, "H3")).photoIds).toEqual([b.id]);
    expect((await svc.getHito(ctx, project.id, h3.id)).photoIds).toEqual([b.id]);
    await expect(svc.setActaPhotos(ctx, project.id, h3.id, { photoIds: [a.id, b.id] })).rejects.toMatchObject({ code: "not_found" });
    expect((await find(ctx, project.id, "H3")).photoIds).toEqual([b.id]);
  });
});

describe("getHito's history", () => {
  it("gives the events newest first, with who did each and no storage pathname", async () => {
    const { tenant, project, ctx, byCode } = await setup();
    const h3 = byCode("H3");
    await db.update(users).set({ name: "Laura Gestora" }).where(eq(users.id, ctx.userId));
    const admin = await createTestUser(tenant.id, { role: "admin", name: "Ana Admin" });
    const actx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };

    await svc.uploadHitoFile(ctx, project.id, h3.id, "acta", { file: pdf("%PDF-1"), date: "2026-09-24" });
    await svc.uploadHitoFile(actx, project.id, h3.id, "acta", { file: pdf("%PDF-2 bis"), date: "2026-09-25" });
    await svc.registerPayment(ctx, project.id, h3.id, { paidOn: "2026-09-30" });
    await svc.cancelPayment(actx, project.id, h3.id);
    await svc.removeHitoFile(ctx, project.id, h3.id, "acta");
    // Another hito's history stays its own.
    await svc.registerPayment(ctx, project.id, byCode("H0").id, { paidOn: "2026-02-03" });

    const { events, ...hito } = await svc.getHito(ctx, project.id, h3.id);
    expect(hito).toMatchObject({ code: "H3", paidOn: null, actaSignedOn: null });
    expect(events).toEqual([
      { id: expect.any(String), at: expect.any(String), userName: "Laura Gestora", action: "acta_removed", detail: { date: "2026-09-25", sizeBytes: 10 } },
      { id: expect.any(String), at: expect.any(String), userName: "Ana Admin", action: "payment_cancelled", detail: { paidOn: "2026-09-30", amountCents: 82_500 } },
      { id: expect.any(String), at: expect.any(String), userName: "Laura Gestora", action: "payment_registered", detail: { paidOn: "2026-09-30", amountCents: 82_500, previous: null } },
      { id: expect.any(String), at: expect.any(String), userName: "Ana Admin", action: "acta_uploaded", detail: { date: "2026-09-25", sizeBytes: 10, previous: { date: "2026-09-24", sizeBytes: 6 } } },
      { id: expect.any(String), at: expect.any(String), userName: "Laura Gestora", action: "acta_uploaded", detail: { date: "2026-09-24", sizeBytes: 6, previous: null } },
    ]);
    expect(new Date(events[0]!.at).toISOString()).toBe(events[0]!.at);
    expect(JSON.stringify(events)).not.toMatch(/pathname|tenants\//);

    // The list has no history.
    expect(await find(ctx, project.id, "H3")).not.toHaveProperty("events");
    expect((await svc.getHito(ctx, project.id, byCode("H4").id)).events).toEqual([]);
  });

  it("keeps an event once its user is deleted", async () => {
    const { tenant, project, byCode } = await setup();
    const admin = await createTestUser(tenant.id, { role: "admin" });
    const actx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
    await svc.registerPayment(actx, project.id, byCode("H3").id, { paidOn: "2026-09-30" });
    const temp = await createTestUser(tenant.id, { role: "manager" });
    await svc.cancelPayment({ tenantId: tenant.id, userId: temp.id, role: "manager" }, project.id, byCode("H3").id);
    await db.delete(users).where(eq(users.id, temp.id));

    expect((await svc.getHito(actx, project.id, byCode("H3").id)).events).toMatchObject([
      { action: "payment_cancelled", userName: null },
      { action: "payment_registered", userName: "Test User" },
    ]);
  });
});

describe("access", () => {
  it("lets viewers read but not change", async () => {
    const { tenant, project, ctx, byCode } = await setup();
    const h0 = byCode("H0").id;
    await svc.uploadHitoFile(ctx, project.id, h0, "invoice", { file: pdf(), date: "2026-02-01" });
    await svc.registerPayment(ctx, project.id, h0, { paidOn: "2026-02-03" });
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const vctx: Ctx = { tenantId: tenant.id, userId: viewer.id, role: "viewer" };

    expect(await svc.listHitos(vctx, project.id)).toHaveLength(10);
    await expect(svc.registerPayment(vctx, project.id, h0, { paidOn: "2026-02-04" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.cancelPayment(vctx, project.id, h0)).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.uploadHitoFile(vctx, project.id, h0, "invoice", { file: pdf(), date: "2026-02-02" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.removeHitoFile(vctx, project.id, h0, "invoice")).rejects.toMatchObject({ code: "forbidden" });

    // Untouched, and nothing more logged; the viewer reads the history.
    expect(await find(vctx, project.id, "H0")).toMatchObject({ paidOn: "2026-02-03", invoicedOn: "2026-02-01" });
    expect((await svc.getHito(vctx, project.id, h0)).events.map((e) => e.action)).toEqual(["payment_registered", "invoice_uploaded"]);
    expect(files.size).toBe(1);
  });

  it("keeps tenants apart", async () => {
    const { project, ctx, byCode } = await setup();
    const other = await setup();
    const h3 = byCode("H3").id;
    await svc.uploadHitoFile(ctx, project.id, h3, "acta", { file: pdf(), date: "2026-09-24" });
    await svc.registerPayment(ctx, project.id, h3, { paidOn: "2026-09-30" });

    await expect(svc.listHitos(other.ctx, project.id)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.updateHito(other.ctx, other.project.id, h3, { name: "X" })).rejects.toMatchObject({ code: "not_found" });

    // Neither through the hito's project nor through their own.
    for (const projectId of [project.id, other.project.id]) {
      const code = projectId === project.id ? "project_not_found" : "not_found";
      await expect(svc.getHito(other.ctx, projectId, h3)).rejects.toMatchObject({ code });
      await expect(svc.registerPayment(other.ctx, projectId, h3, { paidOn: "2026-10-01" })).rejects.toMatchObject({ code });
      await expect(svc.cancelPayment(other.ctx, projectId, h3)).rejects.toMatchObject({ code });
      await expect(svc.uploadHitoFile(other.ctx, projectId, h3, "acta", { file: pdf(), date: "2026-10-01" })).rejects.toMatchObject({ code });
      await expect(svc.removeHitoFile(other.ctx, projectId, h3, "acta")).rejects.toMatchObject({ code });
    }
    // Their own H3 shows none of it, and the hito is as it was.
    expect((await svc.getHito(other.ctx, other.project.id, other.byCode("H3").id)).events).toEqual([]);
    expect(await find(ctx, project.id, "H3")).toMatchObject({ paidOn: "2026-09-30", actaSignedOn: "2026-09-24" });
    expect((await stored(h3)).map((e) => [e.action, e.tenantId])).toEqual([
      ["acta_uploaded", ctx.tenantId],
      ["payment_registered", ctx.tenantId],
    ]);
    expect(files.size).toBe(1);
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
