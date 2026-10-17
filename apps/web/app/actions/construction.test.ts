import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPhoto, createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { seedObra } from "@repo/core/seed";
import { signInAs } from "../../test/session";
import {
  addIssueFileAction,
  correctChapterAction,
  createIssueAction,
  deleteIssueFileAction,
  finishChapterAction,
  getConstructionChapter,
  getConstructionControl,
  getConstructionCosts,
  getConstructionHeader,
  getConstructionIssues,
  getConstructionPhotos,
  reviewChangesAction,
  startChapterAction,
  updateIssueAction,
} from "./construction";

// The services are covered in packages/core; these tests cover the adapter:
// session → core → `{ error }` / revalidation.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

async function setup(role: "admin" | "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const staff = await createTestUser(tenant.id, { role: "admin" });
  const user = await createTestUser(tenant.id, { role });
  const project = await createTestProject(tenant.id);
  await seedObra({ tenantId: tenant.id, userId: staff.id, role: "admin" }, project.id);
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { tenant, project };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(revalidatePath).mockClear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("reads", () => {
  it("give the Obra tab's pages and whether the caller may edit", async () => {
    const { tenant, project } = await setup("viewer");
    await createTestPhoto(tenant.id, project.id, { chapterCode: "06" });

    expect(await getConstructionControl(project.id)).toMatchObject({ canManage: false, control: { sources: { planning: "mock" } } });
    expect(await getConstructionChapter(project.id, "06")).toMatchObject({ detail: { chapter: { code: "06" } }, canManage: false });
    expect((await getConstructionCosts(project.id))!.costs.chapters.length).toBeGreaterThan(0);
    expect(await getConstructionIssues(project.id)).toEqual({ issues: [], canManage: false });
    const header = await getConstructionHeader(project.id);
    expect(header).toMatchObject({ canManage: false, header: { ref: project.ref, openIssues: 0, today: "2026-10-17" } });
    expect(header!.header.chapters).toContainEqual({ code: "06", name: expect.any(String) });
    expect((await getConstructionPhotos(project.id))!.photos).toHaveLength(1);
  });

  it("are null for another tenant's project or when signed out", async () => {
    const { project } = await setup();
    await setup();
    expect(await getConstructionControl(project.id)).toBeNull();
    expect(await getConstructionChapter(project.id, "06")).toBeNull();

    signInAs(null);
    expect(await getConstructionIssues(project.id)).toBeNull();
  });
});

describe("progress", () => {
  it("starts, finishes and corrects a chapter, revalidating the project", async () => {
    const { project } = await setup();

    expect(await startChapterAction(project.id, "06", "2026-09-28")).toEqual({ success: true });
    expect(await finishChapterAction(project.id, "06", "2026-10-16")).toEqual({ success: true, invoiceRequested: null });
    expect(await correctChapterAction(project.id, "06", { actualEnd: "2026-10-17", note: "Remates" })).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");

    const { detail } = (await getConstructionChapter(project.id, "06"))!;
    expect(detail.chapter).toMatchObject({ state: "finished", actualStart: "2026-09-28", actualEnd: "2026-10-17" });
    expect(await reviewChangesAction(project.id)).toEqual({ success: true });
  });

  it("returns core errors as state without revalidating", async () => {
    const { project } = await setup();
    expect(await finishChapterAction(project.id, "06", "2026-10-16")).toEqual({ error: "invalid_state" });

    signInAs({ ...(await viewerOf(project.tenantId)) });
    expect(await startChapterAction(project.id, "06", "2026-10-01")).toEqual({ error: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

async function viewerOf(tenantId: string) {
  const viewer = await createTestUser(tenantId, { role: "viewer" });
  return { tenantId, userId: viewer.id, role: "viewer" as const };
}

describe("issues", () => {
  it("creates a record, attaches a file, updates and detaches it", async () => {
    const { project } = await setup();

    const created = await createIssueAction(project.id, {
      kind: "issue",
      occurredOn: "2026-10-08",
      chapterCode: "06",
      description: "Retraso del panel",
      party: "subcontractor",
    });
    expect(created).toEqual({ success: true, issueId: expect.any(String) });
    const issueId = created!.issueId!;

    const form = new FormData();
    form.set("file", new File(["%PDF-1.7 albarán"], "albaran.pdf", { type: "application/pdf" }));
    expect(await addIssueFileAction(project.id, issueId, null, form)).toEqual({ success: true });
    expect(await updateIssueAction(project.id, issueId, { status: "resolved" })).toEqual({ success: true });

    const [issue] = (await getConstructionIssues(project.id))!.issues;
    expect(issue).toMatchObject({ status: "resolved", files: [{ filename: "albaran.pdf" }] });
    expect(await deleteIssueFileAction(project.id, issueId, issue!.files[0]!.id)).toEqual({ success: true });
  });

  it("returns the service's errors", async () => {
    const { project } = await setup();
    expect(await createIssueAction(project.id, { kind: "issue" })).toEqual({ error: "missing_fields" });
    expect(await updateIssueAction(project.id, "nope", { status: "resolved" })).toEqual({ error: "not_found" });
  });
});
