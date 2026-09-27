import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { budgetService, hitosService, obraService as svc, type Ctx } from "../src";
import { seedObra } from "../src/seed/seed-obra";
import { files } from "../src/testing";

vi.mock("../src/storage", () => import("../src/testing"));

async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, {
    clientUserId: client.id,
    startDate: new Date("2026-05-04T00:00:00Z"),
    completionDate: new Date("2027-02-05T00:00:00Z"),
  });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  return { tenant, client, project, ctx };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-27T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("getObra", () => {
  it("summarises a project without a budget", async () => {
    const { project, ctx } = await setup();

    expect(await svc.getObra(ctx, project.id)).toMatchObject({
      stage: 1,
      budget: null,
      progressPct: 0,
      chapters: [],
      hitos: [],
      term: { week: 21, totalWeeks: 40 },
    });
  });

  it("summarises the real Castrillón budget half built", async () => {
    const { project, ctx } = await setup();
    await seedObra(ctx, project.id);

    const obra = await svc.getObra(ctx, project.id);

    expect(obra.stage).toBe(6);
    expect(obra.budget).toMatchObject({ number: 3, reference: "036/2026", totalCents: 44_820_503 });
    expect(obra.chapters.map((c) => c.code)).toEqual([
      "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "17", "16",
    ]);
    expect(obra.chapters.find((c) => c.code === "05")).toMatchObject({ progressPct: 80, hitoCode: "H4", status: "active" });
    expect(obra.progressPct).toBe(52);
    expect(obra.paidCents).toBe(2_241_025 + 3_137_435 + 5_378_460);
    expect(obra.invoicedUnpaidCents).toBe(6_723_075);
    expect(obra.hitos.find((h) => h.code === "H3")).toMatchObject({ status: "invoiced", dueOn: "2026-10-01" });
  });
});

describe("setStage", () => {
  it("moves the project to a stage 1–8", async () => {
    const { project, ctx } = await setup();
    await svc.setStage(ctx, project.id, { stage: 5 });
    expect((await svc.getObra(ctx, project.id)).stage).toBe(5);

    await expect(svc.setStage(ctx, project.id, { stage: 9 })).rejects.toMatchObject({ code: "invalid_stage" });
  });

  it("is for admins and managers", async () => {
    const { project } = await setup();
    const viewer = await setup("viewer");
    await expect(svc.setStage(viewer.ctx, viewer.project.id, { stage: 2 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.setStage(viewer.ctx, project.id, { stage: 2 })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("getChapter", () => {
  it("shows a chapter of the accepted budget with its hito and photos", async () => {
    const { tenant, project, ctx } = await setup();
    await seedObra(ctx, project.id);
    const photo = await createTestPhoto(tenant.id, project.id, { chapterCode: "05" });
    await createTestPhoto(tenant.id, project.id, { chapterCode: "07" });

    const detail = await svc.getChapter(ctx, project.id, "05");

    expect(detail.chapter).toMatchObject({ code: "05", name: "Envolvente Térmica — Paneles Thermochip", totalCents: 8_630_439 });
    expect(detail.chapter.lines).toHaveLength(6);
    expect(detail.hito).toMatchObject({ code: "H4" });
    expect(detail.photos.map((p) => p.id)).toEqual([photo.id]);
  });

  it("fails for an unknown chapter or before a budget is accepted", async () => {
    const { project, ctx } = await setup();
    await expect(svc.getChapter(ctx, project.id, "05")).rejects.toMatchObject({ code: "no_budget" });
    await seedObra(ctx, project.id);
    await expect(svc.getChapter(ctx, project.id, "99")).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps tenants apart", async () => {
    const { project, ctx } = await setup();
    await seedObra(ctx, project.id);
    const other = await setup();
    await expect(svc.getChapter(other.ctx, project.id, "05")).rejects.toMatchObject({ code: "project_not_found" });
  });
});

describe("getClientObra", () => {
  it("gives the client's phases, hitos and progress", async () => {
    const { tenant, client, project, ctx } = await setup();
    await seedObra(ctx, project.id);
    await createTestPhoto(tenant.id, project.id, { chapterCode: "05" });

    const obra = (await svc.getClientObra(tenant.id, client.id))!;

    expect(obra).toMatchObject({
      stage: 6,
      progressPct: 52,
      totalCents: 44_820_503,
      vatRateBp: 1000,
      term: { week: 21, totalWeeks: 40, lateDays: 0 },
    });
    expect(obra.phases.map((p) => [p.key, p.status, p.progressPct])).toEqual([
      ["pre", "done", 100],
      ["H2", "done", 100],
      ["H3", "done", 100],
      ["H4", "active", 69],
      ["H5", "active", 15],
      ["H6", "active", 10],
      ["H7", "pending", 0],
      ["H8", "pending", 0],
      ["H9", "active", 11],
    ]);
    expect(obra.phases[3]).toMatchObject({ name: "Envolvente estanca", photoCount: 1 });
    expect(obra.currentPhaseKey).toBe("H4");
    expect(obra.hitos).toHaveLength(10);
  });

  it("shows nothing of a budget that is still a draft", async () => {
    const { tenant, client, project, ctx } = await setup();
    const { revisionId } = await budgetService.createBudget(ctx, project.id, {});
    const { chapterId } = await budgetService.addChapter(ctx, project.id, revisionId, { code: "01", name: "X" });
    await budgetService.addLine(ctx, project.id, chapterId, { code: "01.01", description: "X", unit: "pa", quantity: 1, unitPriceCents: 100_000 });

    const obra = (await svc.getClientObra(tenant.id, client.id))!;
    expect(obra).toMatchObject({ totalCents: 0, progressPct: 0 });
    expect(obra.hitos.every((h) => h.amountCents === 0)).toBe(true);
    expect((await svc.getObra(ctx, project.id)).budget).toBeNull();
  });

  it("is null without a project, and empty before a budget", async () => {
    const { tenant, client } = await setup();
    const lonely = await createTestUser(tenant.id, { role: "client" });

    expect(await svc.getClientObra(tenant.id, lonely.id)).toBeNull();
    expect(await svc.getClientObra(tenant.id, client.id)).toMatchObject({ phases: [], hitos: [], progressPct: 0 });
  });

  it("only shows the client's own project", async () => {
    const { ctx, project } = await setup();
    await seedObra(ctx, project.id);
    const other = await setup();
    expect(await svc.getClientObra(other.tenant.id, other.client.id)).toMatchObject({ hitos: [] });
    // A client looked up under another tenant has no project there.
    const third = await setup();
    expect(await svc.getClientObra(other.tenant.id, third.client.id)).toBeNull();
  });
});

describe("seedObra", () => {
  it("loads the whole Castrillón budget", async () => {
    const { project, ctx } = await setup();
    await seedObra(ctx, project.id);

    const { revision } = await budgetService.getBudget(ctx, project.id);
    expect(revision!.chapters.flatMap((c) => c.lines)).toHaveLength(102);
    expect(revision!.chapters.find((c) => c.code === "17")?.change).toBeNull();
    expect((await hitosService.listHitos(ctx, project.id)).map((h) => h.status)).toEqual([
      "paid", "paid", "paid", "invoiced", "active", "active", "active", "pending", "pending", "active",
    ]);
  });
});
