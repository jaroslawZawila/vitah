import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { signInAs } from "../../test/session";
import {
  acceptRevisionAction,
  addChapterAction,
  addLineAction,
  createBudgetAction,
  createRevisionAction,
  deleteChapterAction,
  deleteLineAction,
  deleteRevisionAction,
  getProjectBudget,
  updateChapterAction,
  updateLineAction,
  updateRevisionAction,
} from "./budget";

// The service is covered in packages/core; these tests cover the adapter.

vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

async function setup(role: "admin" | "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const project = await createTestProject(tenant.id);
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { tenant, project };
}

const revision = async (projectId: string, revisionId?: string) =>
  (await getProjectBudget(projectId, revisionId))!.budget.revision!;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});

describe("budget actions", () => {
  it("builds a draft, accepts it and starts a new revision", async () => {
    const { project } = await setup();

    expect(await createBudgetAction(project.id, { reference: "036/2026" })).toEqual({ success: true });
    const draft = await revision(project.id);
    expect(await updateRevisionAction(project.id, draft.id, { builtAreaM2: 253.45 })).toEqual({ success: true });
    expect(await addChapterAction(project.id, draft.id, { code: "01", name: "Actuaciones previas" })).toEqual({ success: true });
    const chapterId = (await revision(project.id)).chapters[0]!.id;
    expect(
      await addLineAction(project.id, chapterId, {
        code: "01.01",
        description: "Desbroce",
        unit: "m²",
        quantity: 265,
        unitPriceCents: 350,
      }),
    ).toEqual({ success: true });
    const lineId = (await revision(project.id)).chapters[0]!.lines[0]!.id;
    expect(await updateLineAction(project.id, lineId, { quantity: 300 })).toEqual({ success: true });
    expect(await updateChapterAction(project.id, chapterId, { name: "Movimiento de tierras" })).toEqual({ success: true });

    expect(await revision(project.id)).toMatchObject({
      reference: "036/2026",
      builtAreaM2: 253.45,
      totalCents: 105_000,
      chapters: [{ name: "Movimiento de tierras", lines: [{ quantity: 300 }] }],
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");

    expect(await acceptRevisionAction(project.id, draft.id)).toEqual({ success: true });
    expect(await createRevisionAction(project.id)).toEqual({ success: true });
    const budget = (await getProjectBudget(project.id))!.budget;
    expect(budget.revisions.map((r) => [r.number, r.status])).toEqual([
      [1, "draft"],
      [0, "accepted"],
    ]);

    const copy = budget.revision!;
    expect(await deleteLineAction(project.id, copy.chapters[0]!.lines[0]!.id)).toEqual({ success: true });
    expect(await deleteChapterAction(project.id, copy.chapters[0]!.id)).toEqual({ success: true });
    expect(await deleteRevisionAction(project.id, copy.id)).toEqual({ success: true });
    expect((await getProjectBudget(project.id))!.budget.revisions).toHaveLength(1);
  });

  it("shows a given revision", async () => {
    const { project } = await setup();
    await createBudgetAction(project.id, {});
    const rev0 = await revision(project.id);
    await acceptRevisionAction(project.id, rev0.id);
    await createRevisionAction(project.id);

    expect((await revision(project.id, rev0.id)).number).toBe(0);
    expect(await getProjectBudget(project.id, "nope")).toBeNull();
  });

  it("returns core errors as state", async () => {
    const { project } = await setup();
    await createBudgetAction(project.id, {});

    expect(await createBudgetAction(project.id, {})).toEqual({ error: "budget_exists" });
    const draft = await revision(project.id);
    expect(await addChapterAction(project.id, draft.id, { code: "", name: "X" })).toEqual({ error: "missing_fields" });
  });

  it("is read-only for viewers, and empty for other tenants", async () => {
    const { project } = await setup("viewer");
    expect(await getProjectBudget(project.id)).toEqual({
      budget: { revisions: [], revision: null },
      canManage: false,
    });
    expect(await createBudgetAction(project.id, {})).toEqual({ error: "forbidden" });

    await setup();
    expect(await getProjectBudget(project.id)).toBeNull();
  });
});
