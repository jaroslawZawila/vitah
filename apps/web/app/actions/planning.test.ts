import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { seedObra } from "@repo/core/seed";
import { signInAs } from "../../test/session";
import {
  approvePlanningDraftAction,
  createPlanningDraftAction,
  discardPlanningDraftAction,
  getPlanning,
  getPlanningDraft,
  getPlanningVersions,
  updatePlanningDraftAction,
} from "./planning";

// The service is covered in packages/core; these tests cover the adapter:
// session → core → `{ error }` / revalidation.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

async function setup(role: "admin" | "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const staff = await createTestUser(tenant.id, { role: "admin" });
  const user = await createTestUser(tenant.id, { role });
  const project = await createTestProject(tenant.id, { startDate: new Date("2026-03-02T00:00:00Z") });
  await seedObra({ tenantId: tenant.id, userId: staff.id, role: "admin" }, project.id);
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { tenant, project };
}

const FIRST_PLAN = { from: "template", region: "as", augustClosure: true, christmasClosure: true };

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(revalidatePath).mockClear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("planning actions", () => {
  it("generate, save and approve a plan, refreshing the project's tabs", async () => {
    const { project } = await setup();
    expect((await getPlanning(project.id))?.planning.baseline).toBeNull();
    expect(await getPlanningDraft(project.id)).toBeNull();

    expect(await createPlanningDraftAction(project.id, FIRST_PLAN)).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");
    const { draft, canManage } = (await getPlanningDraft(project.id))!;
    expect(canManage).toBe(true);
    const items = draft.rows.map((r) => ({ ...r, durationDays: r.code === "07" ? 30 : r.durationDays }));

    expect(await updatePlanningDraftAction(project.id, { items })).toEqual({ success: true });
    expect(await approvePlanningDraftAction(project.id, { items }, "")).toEqual({ success: true });
    const planning = (await getPlanning(project.id))!.planning;
    expect(planning.baseline?.rows.find((r) => r.code === "07")?.durationDays).toBe(30);

    // A change needs its reason; nothing is approved without it.
    expect(await createPlanningDraftAction(project.id, { from: "baseline" })).toEqual({ success: true });
    expect(await approvePlanningDraftAction(project.id, { items }, " ")).toEqual({ error: "change_reason_required" });
    expect(await approvePlanningDraftAction(project.id, { items }, "Retraso de la bomba de calor")).toEqual({ success: true });
    expect((await getPlanningVersions(project.id))?.versions.map((v) => v.status)).toEqual(["approved", "superseded"]);
  });

  it("return core's error codes", async () => {
    const { project } = await setup();
    expect(await createPlanningDraftAction(project.id, { ...FIRST_PLAN, region: "xx" })).toEqual({ error: "invalid_input" });
    expect(await discardPlanningDraftAction(project.id)).toEqual({ error: "not_found" });
    await createPlanningDraftAction(project.id, FIRST_PLAN);
    expect(await createPlanningDraftAction(project.id, FIRST_PLAN)).toEqual({ error: "draft_exists" });
    expect(await discardPlanningDraftAction(project.id)).toEqual({ success: true });
  });

  it("let viewers read but not write, and keep other tenants out", async () => {
    const { project } = await setup("viewer");
    expect((await getPlanning(project.id))?.canManage).toBe(false);
    expect(await createPlanningDraftAction(project.id, FIRST_PLAN)).toEqual({ error: "forbidden" });

    const other = await createTestTenant();
    signInAs({ tenantId: other.id, userId: (await createTestUser(other.id, { role: "admin" })).id, role: "admin" });
    expect(await getPlanning(project.id)).toBeNull();
    expect(await createPlanningDraftAction(project.id, FIRST_PLAN)).toEqual({ error: "project_not_found" });
  });
});
