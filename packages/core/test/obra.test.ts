import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { budgetService, hitosService, obraService as svc, planningService, projectClientService, type Ctx } from "../src";
import { framerDraft } from "./budget-fixture";

/** The seed's overall progress (seed-obra.ts PROGRESS), weighted by amount. */
const PROGRESS_PCT = 33;
import { seedObra } from "../src/seed/seed-obra";
import { BUDGET_CHAPTER_CODES } from "../src/contract";
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

  it("summarises the real Caviedes budget part built", async () => {
    const { project, ctx } = await setup();
    await seedObra(ctx, project.id);

    const obra = await svc.getObra(ctx, project.id);

    expect(obra.stage).toBe(6);
    // 519.948,64 € in PreFRAMER_Caviedes_Valdadiga_V1.pdf; seeded at cost with
    // 13 % + 6 % on top, a few unit prices come back a cent off.
    expect(obra.budget).toMatchObject({ number: 0, reference: "004/2026", totalCents: 51_995_083 });
    expect(obra.chapters.map((c) => c.code)).toEqual(BUDGET_CHAPTER_CODES);
    expect(obra.chapters.find((c) => c.code === "05")).toMatchObject({ progressPct: 72, hitoCode: "H4", status: "active" });
    expect(obra.progressPct).toBe(PROGRESS_PCT);
    // H0–H2 (5 %, 7 %, 12 %) paid and H3 (14 %) invoiced: 25.997,54, 36.396,56, 62.394,10 and 72.793,12 €.
    expect(obra.paidCents).toBe(2_599_754 + 3_639_656 + 6_239_410);
    expect(obra.invoicedUnpaidCents).toBe(7_279_312);
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

    expect(detail.chapter).toMatchObject({ code: "05", name: "Cubierta inclinada y recogida de aguas pluviales", totalCents: 5_535_935 });
    expect(detail.chapter.lines).toHaveLength(9);
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
      progressPct: PROGRESS_PCT,
      totalCents: 51_995_083,
      vatRateBp: 1000,
      term: { week: 21, totalWeeks: 40, lateDays: 0 },
    });
    expect(obra.phases.map((p) => [p.key, p.status, p.progressPct])).toEqual([
      ["pre", "done", 100],
      ["H2", "done", 100],
      ["H3", "done", 100],
      ["H4", "active", 30],
      ["H5", "pending", 0],
      ["H6", "pending", 0],
      ["H7", "pending", 0],
      ["H8", "pending", 0],
      ["H9", "active", 9],
    ]);
    expect(obra.phases[3]).toMatchObject({ name: "Envolvente estanca: Thermochip, cubierta y carpintería exterior", photoCount: 1 });
    expect(obra.currentPhaseKey).toBe("H4");
    expect(obra.hitos).toHaveLength(10);
  });

  it("measures to the approved plan's handover and dates its phases by it", async () => {
    const { tenant, client, project, ctx } = await setup("admin");
    await seedObra(ctx, project.id);
    const before = (await svc.getClientObra(tenant.id, client.id))!;
    expect(before.term?.completionDate).toBe("2027-02-05");
    expect(before.phases.every((p) => p.plannedEnd === null)).toBe(true);

    // Re-planned to start two weeks after the project's 4 May.
    await planningService.createPlanningDraft(ctx, project.id, { from: "template", startDate: "2026-05-18" });
    await planningService.approvePlanningDraft(ctx, project.id, {});
    const { baseline } = await planningService.getPlanning(ctx, project.id);
    const endOf = new Map(baseline!.rows.map((r) => [r.code, r.plannedEnd]));

    const obra = (await svc.getClientObra(tenant.id, client.id))!;
    expect(obra.term).toMatchObject({ startDate: "2026-05-18", completionDate: baseline!.endDate, week: 19 });
    expect(obra.term?.totalWeeks).not.toBe(before.term?.totalWeeks);
    expect(await projectClientService.getClientProject(tenant.id, client.id)).toMatchObject({
      startDate: "2026-05-18",
      completionDate: baseline!.endDate,
    });
    for (const phase of obra.phases) {
      // Its planned chapters' last end (a hito may hold one the plan leaves out, like 20).
      const ends = phase.chapters.flatMap((c) => endOf.get(c.code) ?? []).sort();
      expect(phase.plannedEnd).toBe(phase.key === "pre" ? null : (ends.at(-1) ?? null));
    }
  });

  it("shows nothing of a budget that is still a draft", async () => {
    const { tenant, client, project, ctx } = await setup();
    await framerDraft(ctx, project.id, ["01"]);

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
  it("loads the whole Caviedes budget, the pool offered but not chosen", async () => {
    const { project, ctx } = await setup();
    await seedObra(ctx, project.id);

    const { revision } = await budgetService.getBudget(ctx, project.id);
    // 145 lines in 01–19, and chapter 20's: 5 % of their cost; at cost, the
    // document's 24.759,46 € over 1.19.
    expect(revision!.chapters.flatMap((c) => c.lines)).toHaveLength(146);
    expect(revision!.chapters.find((c) => c.code === "20")).toMatchObject({ totalCents: 2_080_605 });
    expect(revision).toMatchObject({ overheadBp: 1300, profitBp: 600, totalCents: 51_995_083 });
    // The pool: 45.975,00 € in the document.
    expect(revision!.options).toMatchObject([{ code: "OP1", priceCents: 4_597_534, chosen: false }]);
    expect(revision!.options[0]!.lines.map((l) => l.code)).toEqual(Array.from({ length: 11 }, (_, i) => `OP.${String(i + 1).padStart(2, "0")}`));
    expect(revision!.contractTotalCents).toBe(51_995_083);
    expect((await hitosService.listHitos(ctx, project.id)).map((h) => h.status)).toEqual([
      "paid", "paid", "paid", "invoiced", "active", "pending", "pending", "pending", "pending", "active",
    ]);
  });
});
