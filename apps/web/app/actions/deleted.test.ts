import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDocument, createTestPhoto, createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { documentsService, photosService, projectsService, type Ctx } from "@repo/core";
import { TO_FORBIDDEN, TO_LOGIN } from "../../test/navigation";
import { signInAs } from "../../test/session";
import DeletedPage from "../dashboard/eliminados/page";
import { getDeleted, listDeletedAction, restoreDeletedAction } from "./deleted";

// The service is covered in packages/core; these tests cover the adapter and the page.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

/** An obra with a deleted document and a deleted photo; signed in as `role`. */
async function setup(role: Ctx["role"] = "admin") {
  const tenant = await createTestTenant();
  const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
  const project = await createTestProject(tenant.id, { ref: "VTH-26-001" });
  const document = await createTestDocument(tenant.id, project.id, { title: "Contrato de obra" });
  const photo = await createTestPhoto(tenant.id, project.id);
  await documentsService.deleteDocument(admin, project.id, document.id);
  await photosService.deletePhoto(admin, project.id, photo.id);
  const user = role === "admin" ? { id: admin.userId } : await createTestUser(tenant.id, { role });
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { tenant, admin, project, document, photo };
}

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});

describe("the deleted records' page and its reads", () => {
  it("gives an admin the first page, with the obras to filter by", async () => {
    const { project, document, photo } = await setup();

    const list = await getDeleted();
    expect(list!.items.map((i) => i.id).sort()).toEqual([document.id, photo.id].sort());
    expect(list!.projects).toEqual([{ id: project.id, ref: "VTH-26-001", deleted: false }]);

    const page = await DeletedPage();
    expect((page.props as { initial: unknown }).initial).toEqual(list);
  });

  it("sends anyone else to \"No tienes permiso\", and a visitor without a session to the login page", async () => {
    await setup("manager");
    await expect(getDeleted()).rejects.toEqual(TO_FORBIDDEN);
    await expect(DeletedPage()).rejects.toEqual(TO_FORBIDDEN);
    await setup("viewer");
    await expect(DeletedPage()).rejects.toEqual(TO_FORBIDDEN);
    signInAs(null);
    await expect(DeletedPage()).rejects.toEqual(TO_LOGIN);
  });

  it("loads another page for the screen's filters and \"Cargar más\"", async () => {
    const { document, photo } = await setup();

    expect((await listDeletedAction({ kind: "photo" })).data!.items.map((i) => i.id)).toEqual([photo.id]);
    expect((await listDeletedAction({ projectId: "another" })).data!.items).toEqual([]);
    const first = await listDeletedAction({ limit: 1 });
    const second = await listDeletedAction({ limit: 1, cursor: first.data!.nextCursor! });
    expect([first.data!.items[0]!.id, second.data!.items[0]!.id].sort()).toEqual([document.id, photo.id].sort());
    expect(second.data!.nextCursor).toBeNull();

    expect(await listDeletedAction({ cursor: "nope" })).toEqual({ error: "invalid_input" });
  });

  it("answers the list action with an error code, not a page, to anyone but an admin", async () => {
    await setup("manager");
    expect(await listDeletedAction({})).toEqual({ error: "forbidden" });
    signInAs(null);
    await expect(listDeletedAction({})).rejects.toEqual(TO_LOGIN);
  });
});

describe("restoreDeletedAction", () => {
  it("restores the record and refreshes every dashboard page", async () => {
    const { admin, project, document } = await setup();

    expect(await restoreDeletedAction("document", document.id)).toEqual({ success: true });
    expect((await documentsService.listDocuments(admin, project.id)).map((d) => d.id)).toEqual([document.id]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
    expect((await getDeleted())!.items.map((i) => i.kind)).toEqual(["photo"]);
  });

  it("answers the error code and refreshes nothing when it can't", async () => {
    const { admin, project, document, photo } = await setup();

    expect(await restoreDeletedAction("document", "no-such-id")).toEqual({ error: "not_found" });
    await projectsService.deleteProject(admin, project.id);
    expect(await restoreDeletedAction("photo", photo.id)).toEqual({ error: "parent_deleted" });
    expect(revalidatePath).not.toHaveBeenCalled();

    // Another tenant's admin restores nothing of this one.
    await setup();
    expect(await restoreDeletedAction("document", document.id)).toEqual({ error: "not_found" });
  });

  it("is the admins' alone", async () => {
    const { admin, project, document } = await setup("manager");
    expect(await restoreDeletedAction("document", document.id)).toEqual({ error: "forbidden" });
    expect(await documentsService.listDocuments(admin, project.id)).toEqual([]);
    signInAs(null);
    await expect(restoreDeletedAction("document", document.id)).rejects.toEqual(TO_LOGIN);
  });
});
