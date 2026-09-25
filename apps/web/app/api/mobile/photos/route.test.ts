import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import { db, eq, users } from "@repo/db";
import { photosService, type Ctx } from "@repo/core";
import { files, testImage } from "@repo/core/testing";
import { GET as list } from "./route";
import { GET as download } from "./[id]/route";

// lib/api also serves /api/v1, which can read the NextAuth session; next-auth
// itself can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

let photo: File;

beforeAll(async () => {
  photo = await testImage("jpeg");
});

function request(token?: string, query = "") {
  return new Request(`http://localhost/api/mobile/photos${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

/** A project with a client and one uploaded photo. */
async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  const { photoId } = await photosService.addPhoto(ctx, project.id, {
    caption: "Fachada sur",
    file: photo,
  });
  const token = await createMobileToken({
    sub: client.id,
    email: client.email,
    name: client.name,
    role: "client",
    tenantId: tenant.id,
  });
  return { client, photoId, token };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("GET /api/mobile/photos", () => {
  it("lists the client's photos", async () => {
    const { photoId, token } = await setup();
    await setup(); // another client's photo

    const res = await list(request(token));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      photos: [
        {
          id: photoId,
          caption: "Fachada sur",
          sizeBytes: photo.size,
          uploadedAt: expect.any(String),
        },
      ],
    });
  });

  it("requires a valid token", async () => {
    expect((await list(request())).status).toBe(401);
    expect((await list(request("garbage"))).status).toBe(401);
  });

  it("rejects deactivated clients", async () => {
    const { client, token } = await setup();
    await db.update(users).set({ active: false }).where(eq(users.id, client.id));

    expect((await list(request(token))).status).toBe(401);
  });
});

describe("GET /api/mobile/photos/:id", () => {
  it("streams the client's own photo", async () => {
    const { photoId, token } = await setup();

    const res = await download(request(token), { params: Promise.resolve({ id: photoId }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array(await photo.arrayBuffer()),
    );
  });

  it("streams the thumbnail with ?size=thumb", async () => {
    const { photoId, token } = await setup();

    const res = await download(request(token, "?size=thumb"), {
      params: Promise.resolve({ id: photoId }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
  });

  it("returns 404 for another client's photo", async () => {
    const { token } = await setup();
    const other = await setup();

    const res = await download(request(token), { params: Promise.resolve({ id: other.photoId }) });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
