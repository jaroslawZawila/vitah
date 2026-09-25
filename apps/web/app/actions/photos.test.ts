import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { files, testImage } from "@repo/core/testing";
import { signInAs } from "../../test/session";
import { addProjectPhotoAction, deleteProjectPhotoAction, getProjectPhotos } from "./photos";

// The service itself is covered in packages/core; these tests cover the
// adapter: session → core → `{ error }` / revalidation.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

function form(fields: Record<string, string | File>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

let image: File;

beforeAll(async () => {
  image = await testImage("jpeg");
});

async function setup(role: "admin" | "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const project = await createTestProject(tenant.id);
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { tenant, project };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(revalidatePath).mockClear();
});

describe("photo actions", () => {
  it("uploads a photo and revalidates the project", async () => {
    const { project } = await setup();

    const state = await addProjectPhotoAction(
      project.id,
      null,
      form({ caption: "Fachada sur", file: image }),
    );

    expect(state).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");
    expect(await getProjectPhotos(project.id)).toEqual({
      photos: [expect.objectContaining({ caption: "Fachada sur" })],
      canManage: true,
    });
  });

  it("returns core errors as form state without revalidating", async () => {
    const { project } = await setup();

    const state = await addProjectPhotoAction(
      project.id,
      null,
      form({ file: new File(["hola"], "x.jpg") }),
    );

    expect(state).toEqual({ error: "invalid_file_type" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not let viewers upload or delete", async () => {
    const { tenant, project } = await setup("viewer");
    const photo = await createTestPhoto(tenant.id, project.id);

    expect(await addProjectPhotoAction(project.id, null, form({ file: image }))).toEqual({
      error: "forbidden",
    });
    expect(await deleteProjectPhotoAction(project.id, photo.id)).toEqual({ error: "forbidden" });
    expect(await getProjectPhotos(project.id)).toEqual({
      photos: [expect.objectContaining({ id: photo.id })],
      canManage: false,
    });
  });

  it("deletes a photo", async () => {
    const { tenant, project } = await setup("admin");
    const photo = await createTestPhoto(tenant.id, project.id);

    expect(await deleteProjectPhotoAction(project.id, photo.id)).toEqual({ success: true });
    expect((await getProjectPhotos(project.id)).photos).toEqual([]);
  });

  it("lists nothing for another tenant's project or when signed out", async () => {
    const { tenant, project } = await setup();
    await createTestPhoto(tenant.id, project.id);

    await setup();
    expect((await getProjectPhotos(project.id)).photos).toEqual([]);

    signInAs(null);
    expect(await getProjectPhotos(project.id)).toEqual({ photos: [], canManage: false });
  });
});
