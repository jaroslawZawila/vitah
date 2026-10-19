import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import {
  budgetService,
  constructionService,
  planningService as svc,
  purchasingService,
  type Ctx,
} from "../src";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

/**
 * A project starting Monday 1 June 2026 (contract to 31 March 2027) with an
 * accepted budget of chapters 01–03: the template chains 01 (10 d) → 02 (25 d) → 03 (28 d).
 */
async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const admin: Ctx = {
    tenantId: tenant.id,
    userId: (await createTestUser(tenant.id, { role: "admin", name: "Laura Martín" })).id,
    role: "admin",
  };
  const project = await createTestProject(tenant.id, {
    startDate: new Date("2026-06-01T00:00:00Z"),
    completionDate: new Date("2027-03-31T00:00:00Z"),
  });
  const { revisionId } = await framerDraft(admin, project.id, ["01", "02", "03"]);
  await budgetService.acceptRevision(admin, project.id, revisionId);
  const ctx: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role, name: "Jorge Ruiz" })).id, role };
  return { tenant, project, ctx, admin };
}

/** No holidays or closures in the way: weeks of five working days. */
const PLAIN = { from: "template", region: null, augustClosure: false, christmasClosure: false };

const datesOf = (rows: { code: string; plannedStart: string; plannedEnd: string }[]) =>
  Object.fromEntries(rows.map((r) => [r.code, `${r.plannedStart}…${r.plannedEnd}`]));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-05-15T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("a first plan", () => {
  it("starts with none, and the Obra tab simulates the dates meanwhile", async () => {
    const { ctx, project } = await setup();
    const planning = await svc.getPlanning(ctx, project.id);
    expect(planning).toMatchObject({ baseline: null, draft: null, startDate: "2026-06-01", completionDate: "2027-03-31" });
    expect(planning.chapters.map((c) => c.code)).toEqual(["01", "02", "03"]);
    expect((await constructionService.getControl(ctx, project.id)).sources.planning).toBe("mock");
  });

  it("is generated from the template, then approved as the baseline Obra and Compras follow", async () => {
    const { ctx, project } = await setup();
    expect(await svc.createPlanningDraft(ctx, project.id, PLAIN)).toMatchObject({ number: 1 });

    const draft = await svc.getPlanningDraft(ctx, project.id);
    expect(draft.version).toMatchObject({ number: 1, status: "draft", createdBy: "Jorge Ruiz", startDate: "2026-06-01" });
    expect(datesOf(draft.rows)).toEqual({
      "01": "2026-06-01…2026-06-12",
      "02": "2026-06-15…2026-07-17",
      "03": "2026-07-20…2026-08-26",
    });
    expect(draft.rows.map((r) => [r.code, r.after, r.hitoCode, r.critical])).toEqual([
      ["01", null, "H2", true],
      ["02", "01", "H2", true],
      ["03", "02", "H3", true],
    ]);
    expect(draft.version.endDate).toBe("2026-08-26");
    expect(draft.baseline).toBeNull();

    // A first plan needs no reason.
    await svc.approvePlanningDraft(ctx, project.id, {});
    const planning = await svc.getPlanning(ctx, project.id);
    expect(planning.draft).toBeNull();
    expect(planning.baseline).toMatchObject({ number: 1, status: "approved", approvedBy: "Jorge Ruiz", endDate: "2026-08-26" });
    expect(planning.baseline!.forecast.endDate).toBe("2026-08-26");

    const control = await constructionService.getControl(ctx, project.id);
    expect(control.sources.planning).toBe("live");
    expect(control.chapters[1]).toMatchObject({ code: "02", plannedStart: "2026-06-15", plannedEnd: "2026-07-17" });
    const purchases = await purchasingService.getProjectPurchases(ctx, project.id);
    expect(purchases.sources.planning).toBe("live");
    expect((await purchasingService.getPurchaseForm(ctx, project.id)).sources.planning).toBe("live");
  });

  it("starts on the date given and follows the region's holidays", async () => {
    const { ctx, project } = await setup();
    await svc.createPlanningDraft(ctx, project.id, { ...PLAIN, startDate: "2026-09-07", region: "as" });
    const draft = await svc.getPlanningDraft(ctx, project.id);
    // Tuesday 8 September is Día de Asturias: ten working days end on the 21st, not the 18th.
    expect(draft.rows[0]).toMatchObject({ plannedStart: "2026-09-07", plannedEnd: "2026-09-21" });
    expect(draft.calendar).toEqual({ region: "as", augustClosure: false, christmasClosure: false });
  });

  it("copies the durations of another project's baseline", async () => {
    const { ctx, project, tenant } = await setup();
    await svc.createPlanningDraft(ctx, project.id, PLAIN);
    const first = await svc.getPlanningDraft(ctx, project.id);
    await svc.updatePlanningDraft(ctx, project.id, {
      items: first.rows.map((r) => ({ ...r, durationDays: r.code === "01" ? 5 : r.durationDays })),
    });
    await svc.approvePlanningDraft(ctx, project.id, {});

    const other = await createTestProject(tenant.id, { startDate: new Date("2026-06-01T00:00:00Z") });
    const { revisionId } = await framerDraft(ctx, other.id, ["01", "02"]);
    await budgetService.acceptRevision(ctx, other.id, revisionId);
    expect((await svc.getPlanning(ctx, other.id)).copyFrom).toEqual([{ projectId: project.id, ref: project.ref }]);
    await svc.createPlanningDraft(ctx, other.id, { ...PLAIN, from: "project", projectId: project.id });
    expect(datesOf((await svc.getPlanningDraft(ctx, other.id)).rows)).toEqual({
      "01": "2026-06-01…2026-06-05",
      "02": "2026-06-08…2026-07-10",
    });
  });

  it("leaves another project's fixed days behind when copying its plan", async () => {
    const { ctx, project, tenant } = await setup();
    await svc.createPlanningDraft(ctx, project.id, PLAIN);
    const first = await svc.getPlanningDraft(ctx, project.id);
    await svc.approvePlanningDraft(ctx, project.id, {
      items: first.rows.map((r) => (r.code === "01" ? { ...r, fixedStart: "2026-06-08" } : r)),
    });

    const other = await createTestProject(tenant.id, { startDate: new Date("2027-02-01T00:00:00Z") });
    const { revisionId } = await framerDraft(ctx, other.id, ["01"]);
    await budgetService.acceptRevision(ctx, other.id, revisionId);
    await svc.createPlanningDraft(ctx, other.id, { ...PLAIN, from: "project", projectId: project.id });
    expect((await svc.getPlanningDraft(ctx, other.id)).rows[0]).toMatchObject({ fixedStart: null, plannedStart: "2027-02-01" });
  });

  it("tells the second of two editors opening a draft at once that one is open", async () => {
    const { ctx, project } = await setup();
    const results = await Promise.allSettled([
      svc.createPlanningDraft(ctx, project.id, PLAIN),
      svc.createPlanningDraft(ctx, project.id, PLAIN),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "draft_exists" } });
  });
});

describe("changing the plan", () => {
  async function approved() {
    const s = await setup();
    await svc.createPlanningDraft(s.ctx, s.project.id, PLAIN);
    await svc.approvePlanningDraft(s.ctx, s.project.id, {});
    return s;
  }

  it("edits a copy of the baseline and needs a reason to approve it", async () => {
    const { ctx, project } = await approved();
    expect(await svc.createPlanningDraft(ctx, project.id, { from: "baseline" })).toMatchObject({ number: 2 });
    await expect(svc.createPlanningDraft(ctx, project.id, { from: "baseline" })).rejects.toMatchObject({ code: "draft_exists" });

    const draft = await svc.getPlanningDraft(ctx, project.id);
    expect(draft.baseline).toEqual({ number: 1, ends: { "01": "2026-06-12", "02": "2026-07-17", "03": "2026-08-26" } });
    const items = draft.rows.map(({ code, after, lagDays, durationDays, fixedStart, leadDays }) => ({ code, after, lagDays, durationDays, fixedStart, leadDays }));
    await svc.updatePlanningDraft(ctx, project.id, {
      region: "md",
      items: items.map((i) => (i.code === "02" ? { ...i, durationDays: 30 } : i)),
    });
    const changed = await svc.getPlanningDraft(ctx, project.id);
    expect(changed.rows[1]).toMatchObject({ code: "02", durationDays: 30, plannedEnd: "2026-07-24", leadDays: 14 });
    await svc.updatePlanningDraft(ctx, project.id, { items: items.map((i) => (i.code === "03" ? { ...i, leadDays: 60 } : i)) });
    expect((await svc.getPlanningDraft(ctx, project.id)).rows[2]!.leadDays).toBe(60);
    // A client that doesn't send lead times (an older one) keeps them.
    await svc.updatePlanningDraft(ctx, project.id, { items: items.map(({ leadDays: _, ...rest }) => rest) });
    expect((await svc.getPlanningDraft(ctx, project.id)).rows[2]!.leadDays).toBe(60);
    await expect(
      svc.updatePlanningDraft(ctx, project.id, { items: items.map((i) => (i.code === "03" ? { ...i, leadDays: 400 } : i)) }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(changed.calendar.region).toBe("md");

    await expect(
      svc.updatePlanningDraft(ctx, project.id, { items: items.map((i) => (i.code === "01" ? { ...i, after: "03" } : i)) }),
    ).rejects.toMatchObject({ code: "dependency_cycle" });
    await expect(svc.updatePlanningDraft(ctx, project.id, { items: items.slice(1) })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      svc.updatePlanningDraft(ctx, project.id, { items: items.map((i) => (i.code === "02" ? { ...i, durationDays: 0 } : i)) }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    // Approving with edits refused saves none of them.
    const longer = items.map((i) => (i.code === "03" ? { ...i, durationDays: 40 } : i));
    await expect(svc.approvePlanningDraft(ctx, project.id, { reason: " ", items: longer })).rejects.toMatchObject({
      code: "change_reason_required",
    });
    expect((await svc.getPlanningDraft(ctx, project.id)).rows[2]!.durationDays).toBe(28);
    // Approved with them, they are saved and approved together.
    await svc.approvePlanningDraft(ctx, project.id, { reason: "Lluvias de septiembre", items: items.map((i) => (i.code === "02" ? { ...i, durationDays: 30 } : i)) });

    const { versions } = await svc.getPlanningVersions(ctx, project.id);
    expect(versions.map((v) => [v.number, v.status, v.reason, v.endDate])).toEqual([
      [2, "approved", "Lluvias de septiembre", "2026-09-02"],
      [1, "superseded", null, "2026-08-26"],
    ]);
    expect(versions[1]!.rows.map((r) => [r.code, r.plannedEnd])).toEqual([
      ["01", "2026-06-12"],
      ["02", "2026-07-17"],
      ["03", "2026-08-26"],
    ]);
  });

  it("forecasts from what Avance records, leaving the baseline as approved", async () => {
    const { ctx, project } = await approved();
    vi.setSystemTime(new Date("2026-06-17T10:00:00Z"));
    await constructionService.startChapter(ctx, project.id, "01", { date: "2026-06-01" });
    await constructionService.finishChapter(ctx, project.id, "01", { date: "2026-06-16" });

    const { baseline } = await svc.getPlanning(ctx, project.id);
    const row = (code: string) => baseline!.rows.find((r) => r.code === code)!;
    expect(row("01")).toMatchObject({ state: "finished", progressPct: 100, critical: false, forecastEnd: "2026-06-16" });
    expect(row("02")).toMatchObject({ plannedStart: "2026-06-15", forecastStart: "2026-06-17", forecastEnd: "2026-07-21", critical: true });
    expect(baseline!.planned.endDate).toBe("2026-08-26");
    expect(baseline!.forecast.endDate).toBe("2026-08-28");

    // A new draft starts from where the works are now.
    await svc.createPlanningDraft(ctx, project.id, { from: "baseline" });
    expect((await svc.getPlanningDraft(ctx, project.id)).rows[1]).toMatchObject({ plannedStart: "2026-06-17" });
  });

  it("throws a draft away and keeps the baseline", async () => {
    const { ctx, project } = await approved();
    await svc.createPlanningDraft(ctx, project.id, { from: "baseline" });
    await svc.discardPlanningDraft(ctx, project.id);
    const planning = await svc.getPlanning(ctx, project.id);
    expect(planning.draft).toBeNull();
    expect(planning.baseline?.number).toBe(1);
    await expect(svc.getPlanningDraft(ctx, project.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.discardPlanningDraft(ctx, project.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("who and what", () => {
  it("lets viewers read but only admins and managers write", async () => {
    const { ctx: viewer, project, admin } = await setup("viewer");
    await expect(svc.createPlanningDraft(viewer, project.id, PLAIN)).rejects.toMatchObject({ code: "forbidden" });
    await svc.createPlanningDraft(admin, project.id, PLAIN);
    await expect(svc.getPlanningDraft(viewer, project.id)).resolves.toMatchObject({ version: { number: 1 } });
    await expect(svc.approvePlanningDraft(viewer, project.id, {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.discardPlanningDraft(viewer, project.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps each tenant to its own projects", async () => {
    const { project, ctx } = await setup();
    await svc.createPlanningDraft(ctx, project.id, PLAIN);
    const other = await createTestTenant();
    const stranger: Ctx = { tenantId: other.id, userId: (await createTestUser(other.id, { role: "admin" })).id, role: "admin" };
    await expect(svc.getPlanning(stranger, project.id)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.getPlanningDraft(stranger, project.id)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.createPlanningDraft(stranger, project.id, PLAIN)).rejects.toMatchObject({ code: "project_not_found" });
    // Nor can a plan be copied from another tenant's project.
    const mine = await createTestProject(other.id, { startDate: new Date("2026-06-01T00:00:00Z") });
    const { revisionId } = await framerDraft(stranger, mine.id, ["01"]);
    await budgetService.acceptRevision(stranger, mine.id, revisionId);
    await svc.approvePlanningDraft(ctx, project.id, {});
    await expect(
      svc.createPlanningDraft(stranger, mine.id, { ...PLAIN, from: "project", projectId: project.id }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("needs an accepted budget, a start date and a known way to start", async () => {
    const tenant = await createTestTenant();
    const ctx: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
    const bare = await createTestProject(tenant.id);
    await expect(svc.createPlanningDraft(ctx, bare.id, PLAIN)).rejects.toMatchObject({ code: "no_budget" });

    const { revisionId } = await framerDraft(ctx, bare.id, ["01"]);
    await budgetService.acceptRevision(ctx, bare.id, revisionId);
    await expect(svc.createPlanningDraft(ctx, bare.id, PLAIN)).rejects.toMatchObject({ code: "missing_fields" });
    await expect(svc.createPlanningDraft(ctx, bare.id, { ...PLAIN, startDate: "2026-02-31" })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(svc.createPlanningDraft(ctx, bare.id, { ...PLAIN, startDate: "2026-06-01", region: "xx" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(svc.createPlanningDraft(ctx, bare.id, { from: "baseline" })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.createPlanningDraft(ctx, bare.id, { from: "magic" })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
