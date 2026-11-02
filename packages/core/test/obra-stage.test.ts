import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDocument, createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, projects, sql } from "@repo/db";
import {
  budgetService,
  constructionService,
  documentsService,
  hitosService,
  obraService,
  type Ctx,
} from "../src";
import { evidenceStage } from "../src/obra-calc";
import { loadObra } from "../src/obra-data";
import { evidenceOf, loadFirstDays, raiseStage } from "../src/obra-stage";
import { files } from "../src/testing";
import { framerDraft, uploadBudgetInput } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

async function setup() {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role: "manager" });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role: "manager" };
  return { tenant, client, project, ctx };
}

const projectRow = async (projectId: string) =>
  (await db.query.projects.findFirst({ where: eq(projects.id, projectId), columns: { obraStage: true, obraRev: true } }))!;
const stageOf = async (projectId: string) => (await projectRow(projectId)).obraStage;
const registerInput = (ctx: Ctx, projectId: string) => uploadBudgetInput(ctx, projectId);

/** A project at stage 4: its files, a budget of chapters 01–02 accepted. */
async function accepted() {
  const s = await setup();
  await registerInput(s.ctx, s.project.id);
  const { revisionId } = await framerDraft(s.ctx, s.project.id, ["01", "02"]);
  await budgetService.acceptRevision(s.ctx, s.project.id, revisionId);
  const hitos = await hitosService.listHitos(s.ctx, s.project.id);
  const hito = (code: string) => hitos.find((h) => h.code === code)!.id;
  const pay = (code: string, paidOn = "2026-06-20") =>
    hitosService.registerPayment(s.ctx, s.project.id, hito(code), { paidOn });
  return { ...s, hito, pay };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-27T10:00:00Z") });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the stage on its own", () => {
  it("follows the process from the project's files to the warranty", async () => {
    const { ctx, project } = await setup();
    const id = project.id;
    expect(await stageOf(id)).toBe(1);

    await registerInput(ctx, id);
    expect(await stageOf(id)).toBe(2);

    const { revisionId } = await framerDraft(ctx, id, ["01", "02"]);
    expect(await stageOf(id)).toBe(3);

    await budgetService.acceptRevision(ctx, id, revisionId, { acceptedOn: "2026-06-12" });
    expect(await stageOf(id)).toBe(4);

    const hitos = await hitosService.listHitos(ctx, id);
    const pay = (code: string, paidOn: string) =>
      hitosService.registerPayment(ctx, id, hitos.find((h) => h.code === code)!.id, { paidOn });
    await pay("H0", "2026-06-20");
    expect(await stageOf(id)).toBe(5);

    // H1 (engineering and licence) is paid before the works start.
    await pay("H1", "2026-07-01");
    expect(await stageOf(id)).toBe(5);

    await constructionService.startChapter(ctx, id, "01", { date: "2026-07-06" });
    expect(await stageOf(id)).toBe(6);

    await constructionService.finishChapter(ctx, id, "01", { date: "2026-08-01" });
    await constructionService.startChapter(ctx, id, "02", { date: "2026-08-03" });
    expect(await stageOf(id)).toBe(6);

    await constructionService.finishChapter(ctx, id, "02", { date: "2026-09-10" });
    expect(await stageOf(id)).toBe(7);

    await pay("H9", "2026-09-25");
    expect(await stageOf(id)).toBe(8);

    const { stage, stageEvidence } = await obraService.getObra(ctx, id);
    expect(stage).toBe(8);
    // The file and the draft are dated by the database's clock.
    const day = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/);
    expect(stageEvidence).toEqual({
      2: day,
      3: day,
      4: "2026-06-12",
      5: "2026-06-20",
      6: "2026-07-06",
      7: "2026-09-10",
      8: "2026-09-25",
    });
  });

  it("counts a document already on the project once it is marked as a budget input", async () => {
    const { ctx, project, tenant } = await setup();
    const doc = await createTestDocument(tenant.id, project.id);

    await documentsService.markBudgetInput(ctx, project.id, doc.id, { budgetInput: "basic" });

    expect(await stageOf(project.id)).toBe(2);
  });

  it("finishes the works through a correction too", async () => {
    const { ctx, project } = await accepted();
    await constructionService.startChapter(ctx, project.id, "01", { date: "2026-07-06" });
    await constructionService.startChapter(ctx, project.id, "02", { date: "2026-07-06" });
    await constructionService.finishChapter(ctx, project.id, "01", { date: "2026-08-01" });

    await constructionService.correctChapter(ctx, project.id, "02", { actualEnd: "2026-09-01" });

    expect(await stageOf(project.id)).toBe(7);
  });

  it("keeps the day the first revision was accepted once a change order is accepted", async () => {
    const { ctx, project } = await setup();
    const { revisionId } = await framerDraft(ctx, project.id, ["01"]);
    await budgetService.acceptRevision(ctx, project.id, revisionId, { acceptedOn: "2026-06-12" });
    const { revisionId: change } = await budgetService.createRevision(ctx, project.id);
    await budgetService.acceptRevision(ctx, project.id, change, { acceptedOn: "2026-09-01" });

    expect((await obraService.getObra(ctx, project.id)).stageEvidence[4]).toBe("2026-06-12");
  });

  it("skips stages the evidence passes over", async () => {
    const { ctx, project } = await setup();
    const { revisionId } = await framerDraft(ctx, project.id, ["01"]);
    await budgetService.acceptRevision(ctx, project.id, revisionId);
    const h0 = (await hitosService.listHitos(ctx, project.id)).find((h) => h.code === "H0")!;

    await hitosService.registerPayment(ctx, project.id, h0.id, { paidOn: "2026-06-20" });

    expect(await stageOf(project.id)).toBe(5);
    expect((await obraService.getObra(ctx, project.id)).stageEvidence).not.toHaveProperty("2");
  });
});

describe("raise-only", () => {
  it("never lowers the stage when a payment is cancelled or a chapter reopened", async () => {
    const { ctx, project, hito, pay } = await accepted();
    await pay("H0");
    await constructionService.startChapter(ctx, project.id, "01", { date: "2026-07-06" });
    await constructionService.startChapter(ctx, project.id, "02", { date: "2026-07-06" });
    await constructionService.finishChapter(ctx, project.id, "01", { date: "2026-08-01" });
    await constructionService.finishChapter(ctx, project.id, "02", { date: "2026-08-01" });
    expect(await stageOf(project.id)).toBe(7);

    await constructionService.correctChapter(ctx, project.id, "02", { actualEnd: null });
    await hitosService.cancelPayment(ctx, project.id, hito("H0"));

    expect(await stageOf(project.id)).toBe(7);
  });

  it("keeps a stage staff set ahead of the evidence", async () => {
    const { ctx, project, pay } = await accepted();
    await obraService.setStage(ctx, project.id, { stage: 6 });

    await pay("H0");

    expect(await stageOf(project.id)).toBe(6);
  });

  it("brings a stage staff set back behind the evidence up again with the next event", async () => {
    const { ctx, project, pay } = await accepted();
    await obraService.setStage(ctx, project.id, { stage: 2 });
    expect(await stageOf(project.id)).toBe(2);

    await pay("H2");

    expect(await stageOf(project.id)).toBe(4);
  });
});

describe("the prod SQL (2026-11-obra-stage-auto.sql)", () => {
  const migration = readFileSync(new URL("../../db/sql/2026-11-obra-stage-auto.sql", import.meta.url), "utf8");
  const setStage = (projectId: string, stage: number) =>
    db.update(projects).set({ obraStage: stage }).where(eq(projects.id, projectId));

  it("catches existing projects up as raiseStage would, and keeps a stage set ahead", async () => {
    const fresh = await setup();
    const withInput = await setup();
    await registerInput(withInput.ctx, withInput.project.id);
    const drafted = await setup();
    await framerDraft(drafted.ctx, drafted.project.id, ["01"]);
    const signed = await accepted();
    const deposit = await accepted();
    await deposit.pay("H0");
    const building = await accepted();
    await constructionService.startChapter(building.ctx, building.project.id, "01", { date: "2026-07-06" });
    const built = await accepted();
    for (const code of ["01", "02"]) {
      await constructionService.startChapter(built.ctx, built.project.id, code, { date: "2026-07-06" });
      await constructionService.finishChapter(built.ctx, built.project.id, code, { date: "2026-08-01" });
    }
    const handed = await accepted();
    await handed.pay("H9");
    const ahead = await accepted();
    await obraService.setStage(ahead.ctx, ahead.project.id, { stage: 7 });

    const old = [fresh, withInput, drafted, signed, deposit, building, built, handed];
    // As the data stood before the stage moved on its own.
    for (const { project } of old) await setStage(project.id, 1);
    await db.execute(sql.raw(migration));
    // Re-running changes nothing.
    await db.execute(sql.raw(migration));

    expect(await Promise.all(old.map(({ project }) => stageOf(project.id)))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const { project, tenant } of old) {
      const [obra, firsts] = await Promise.all([loadObra(tenant.id, project.id), loadFirstDays(tenant.id, project.id)]);
      expect(await stageOf(project.id)).toBe(evidenceStage(evidenceOf(obra, firsts)));
    }
    expect(await stageOf(ahead.project.id)).toBe(7);
  });
});

describe("raiseStage", () => {
  it("tells the client's app, only when it moves the stage", async () => {
    const { ctx, project, pay } = await accepted();
    const obraRev = async () => (await projectRow(project.id)).obraRev;
    await pay("H0");
    const before = await obraRev();

    expect(await raiseStage(ctx.tenantId, project.id)).toBeNull();
    expect(await obraRev()).toBe(before);

    await obraService.setStage(ctx, project.id, { stage: 1 });
    const set = await obraRev();
    expect(await raiseStage(ctx.tenantId, project.id)).toBe(5);
    expect(await obraRev()).toBe(set + 1);
  });

  it("never reaches across tenants", async () => {
    const { ctx, project } = await accepted();
    await obraService.setStage(ctx, project.id, { stage: 1 });
    const other = await createTestTenant();

    expect(await raiseStage(other.id, project.id)).toBeNull();
    expect(await stageOf(project.id)).toBe(1);
  });

  it("never fails the caller", async () => {
    const { ctx, project, pay } = await accepted();
    vi.spyOn(db, "update").mockImplementation(() => {
      throw new Error("database down");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(raiseStage(ctx.tenantId, project.id)).resolves.toBeNull();
    expect(log).toHaveBeenCalled();
    vi.mocked(db.update).mockRestore();
    // The write itself still goes through.
    await expect(pay("H0")).resolves.toBeDefined();
  });
});
