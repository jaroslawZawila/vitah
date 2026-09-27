import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { seedObra } from "@repo/core/seed";
import { signInAs } from "../../test/session";
import {
  addCheckAction,
  cancelPaymentAction,
  getProjectChapter,
  getProjectHito,
  getProjectObra,
  registerPaymentAction,
  savePlanAction,
  removeHitoFileAction,
  saveProgressAction,
  setActaPhotosAction,
  setObraStageAction,
  updateCheckAction,
  updateHitoAction,
  uploadHitoFileAction,
} from "./obra";

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

const hitoOf = async (projectId: string, code: string) =>
  (await getProjectObra(projectId))!.obra.hitos.find((h) => h.code === code)!;

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(revalidatePath).mockClear();
});

describe("reading the obra", () => {
  it("gives the Obra page and whether the caller may edit", async () => {
    const { project } = await setup("viewer");

    const result = await getProjectObra(project.id);

    expect(result).toMatchObject({ canManage: false, obra: { stage: 6, progressPct: 52 } });
    expect(result!.obra.chapters).toHaveLength(17);
  });

  it("gives a chapter, and a hito with the project's photos to pick from", async () => {
    const { tenant, project } = await setup();
    const photo = await createTestPhoto(tenant.id, project.id, { chapterCode: "05" });

    const chapter = await getProjectChapter(project.id, "05");
    expect(chapter).toMatchObject({ canManage: true, hito: { code: "H4" }, photos: [{ id: photo.id }] });

    const h4 = await hitoOf(project.id, "H4");
    const hito = await getProjectHito(project.id, h4.id);
    expect(hito).toMatchObject({ hito: { code: "H4" }, photos: [{ id: photo.id }], canManage: true });
  });

  it("returns null for another tenant's project or when signed out", async () => {
    const { project } = await setup();
    await setup();
    expect(await getProjectObra(project.id)).toBeNull();
    expect(await getProjectChapter(project.id, "05")).toBeNull();

    signInAs(null);
    expect(await getProjectObra(project.id)).toBeNull();
  });
});

describe("obra mutations", () => {
  it("sets the stage and saves progress, revalidating the project", async () => {
    const { project } = await setup();
    const { chapter } = (await getProjectChapter(project.id, "06"))!;

    expect(await setObraStageAction(project.id, 7)).toEqual({ success: true });
    const lines = chapter.lines.map((l) => ({ id: l.id, executedPct: 100 }));
    expect(await saveProgressAction(project.id, lines)).toEqual({ success: true });

    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");
    const obra = (await getProjectObra(project.id))!.obra;
    expect(obra.stage).toBe(7);
    expect(obra.chapters.find((c) => c.code === "06")?.status).toBe("done");
  });

  it("returns core errors as state without revalidating", async () => {
    const { project } = await setup("viewer");

    expect(await setObraStageAction(project.id, 2)).toEqual({ error: "forbidden" });
    expect(await saveProgressAction(project.id, [{ id: "nope", executedPct: 5 }])).toEqual({ error: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("hito mutations", () => {
  it("edits the plan and its checks", async () => {
    const { project } = await setup();
    const h4 = await hitoOf(project.id, "H4");

    expect(await updateHitoAction(project.id, h4.id, { pctBp: 1400, chapterCodes: ["05", "07"] })).toEqual({ success: true });
    expect(await addCheckAction(project.id, h4.id, "Persianas motorizadas")).toEqual({ success: true });
    const check = (await hitoOf(project.id, "H4")).checks[0]!;
    expect(await updateCheckAction(project.id, check.id, { done: true })).toEqual({ success: true });

    const updated = await hitoOf(project.id, "H4");
    expect(updated).toMatchObject({ pctBp: 1400, chapters: [{ code: "05" }, { code: "07" }] });
    expect(updated.checks.map((c) => [c.label, c.done])).toEqual([
      ["Prueba de estanqueidad provisional", true],
      ["Persianas motorizadas", false],
    ]);
  });

  it("saves the plan in one go, or none of it", async () => {
    const { project } = await setup();
    const h3 = await hitoOf(project.id, "H3");
    const h4 = await hitoOf(project.id, "H4");

    expect(await savePlanAction(project.id, [{ id: h3.id, pctBp: 1400, chapterCodes: ["04"] }, { id: h4.id, pctBp: 1400, chapterCodes: ["05"] }])).toEqual({ success: true });
    expect(await savePlanAction(project.id, [{ id: h3.id, pctBp: 1600, chapterCodes: ["04"] }, { id: h4.id, pctBp: -1, chapterCodes: [] }])).toEqual({ error: "invalid_input" });
    expect((await hitoOf(project.id, "H3")).pctBp).toBe(1400);
    expect((await hitoOf(project.id, "H4")).chapters.map((c) => c.code)).toEqual(["05"]);
  });

  it("uploads the acta, picks its photos and records the payment", async () => {
    const { tenant, project } = await setup();
    const h4 = await hitoOf(project.id, "H4");
    const photo = await createTestPhoto(tenant.id, project.id);
    const form = new FormData();
    form.set("file", new File(["%PDF-1.7"], "acta.pdf", { type: "application/pdf" }));
    form.set("date", "2026-10-20");

    expect(await uploadHitoFileAction(project.id, h4.id, "acta", null, form)).toEqual({ success: true });
    expect(await setActaPhotosAction(project.id, h4.id, [photo.id])).toEqual({ success: true });
    expect(await registerPaymentAction(project.id, h4.id, { paidOn: "2026-10-27" })).toEqual({ success: true });
    expect(await hitoOf(project.id, "H4")).toMatchObject({
      status: "paid",
      actaSignedOn: "2026-10-20",
      photoIds: [photo.id],
    });

    expect(await cancelPaymentAction(project.id, h4.id)).toEqual({ success: true });
    expect(await removeHitoFileAction(project.id, h4.id, "acta")).toEqual({ success: true });
    expect(await hitoOf(project.id, "H4")).toMatchObject({ status: "active", actaSignedOn: null });
  });

  it("reports a bad upload", async () => {
    const { project } = await setup();
    const h4 = await hitoOf(project.id, "H4");
    const form = new FormData();
    form.set("file", new File(["hola"], "x.pdf"));
    form.set("date", "2026-10-20");

    expect(await uploadHitoFileAction(project.id, h4.id, "acta", null, form)).toEqual({ error: "invalid_file_type" });
  });
});
