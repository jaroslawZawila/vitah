import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { CoreError, normalizeEmail, photosService as svc, type Ctx } from "../src";
import { files } from "../src/testing";

// sharp is a native library; if it can't load on a server, only uploads may
// fail. Everything else imports @repo/core too (every route, and the portal's
// proxy), so loading the package must not load sharp.
vi.mock("sharp", () => {
  throw new Error("Could not load the \"sharp\" module using the linux-x64 runtime");
});
vi.mock("../src/storage", () => import("../src/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const project = await createTestProject(tenant.id);
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  return { tenant, project, ctx };
}

describe("when sharp can't load", () => {
  it("still loads @repo/core and serves photos", async () => {
    const { tenant, project, ctx } = await setup();
    await createTestPhoto(tenant.id, project.id);

    expect(normalizeEmail(" A@B.es ")).toBe("a@b.es");
    expect(await svc.listPhotos(ctx, project.id)).toHaveLength(1);
  });

  it("fails uploads with a server error, not as a bad file", async () => {
    const { project, ctx } = await setup();
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff]), "x"], "x.jpg");

    const upload = svc.addPhoto(ctx, project.id, { file });

    // Vitest wraps the factory's error in its own message.
    await expect(upload).rejects.toThrow();
    await expect(upload).rejects.not.toBeInstanceOf(CoreError);
    expect(files.size).toBe(0);
  });
});
