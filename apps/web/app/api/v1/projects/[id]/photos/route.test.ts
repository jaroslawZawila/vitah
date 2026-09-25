import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import { MAX_PHOTO_BYTES } from "@repo/core/contract";
import { files } from "@repo/core/testing";
import { GET as list, POST } from "./route";
import { DELETE, GET as download } from "./[photoId]/route";

// Bearer requests never read the NextAuth session, and next-auth itself
// can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

async function staffToken(tenantId: string, role: "manager" | "viewer" = "manager") {
  const user = await createTestUser(tenantId, { role });
  return createMobileToken({ sub: user.id, email: user.email, name: user.name, role, tenantId });
}

function request(token: string, init: { method?: string; body?: BodyInit } = {}) {
  return new Request("http://localhost/api/v1/projects/x/photos", {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}` },
    body: init.body,
  });
}

function upload(projectId: string, token: string, file: File) {
  const body = new FormData();
  body.set("caption", "Cubierta");
  body.set("file", file);
  return POST(request(token, { method: "POST", body }), projectParams(projectId));
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = new File([PNG, "pixels"], "cubierta.png", { type: "image/png" });
const projectParams = (id: string) => ({ params: Promise.resolve({ id }) });
const params = (id: string, photoId: string) => ({ params: Promise.resolve({ id, photoId }) });

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("/api/v1/projects/:id/photos", () => {
  it("uploads, lists, downloads and deletes a photo", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    const token = await staffToken(tenant.id);

    const created = await upload(project.id, token, png);
    expect(created.status).toBe(201);
    const { photoId } = await created.json();

    const listed = await list(request(token), projectParams(project.id));
    expect(await listed.json()).toEqual([
      expect.objectContaining({ id: photoId, caption: "Cubierta", sizeBytes: png.size }),
    ]);

    const file = await download(request(token), params(project.id, photoId));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-disposition")).toBe(
      `inline; filename*=UTF-8''${photoId}.png`,
    );
    expect(file.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(new Uint8Array(await file.arrayBuffer()).slice(0, 8)).toEqual(PNG);

    const deleted = await DELETE(request(token, { method: "DELETE" }), params(project.id, photoId));
    expect(deleted.status).toBe(204);
    expect(files.size).toBe(0);
  });

  it("returns core errors as JSON", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);

    const tooLarge = await upload(
      project.id,
      await staffToken(tenant.id),
      new File([PNG, new Uint8Array(MAX_PHOTO_BYTES)], "big.png"),
    );
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: "file_too_large" });

    const notImage = await upload(
      project.id,
      await staffToken(tenant.id),
      new File(["%PDF-1.7"], "x.png"),
    );
    expect(notImage.status).toBe(400);
    expect(await notImage.json()).toEqual({ error: "invalid_file_type" });

    const viewer = await upload(project.id, await staffToken(tenant.id, "viewer"), png);
    expect(viewer.status).toBe(403);
  });

  it("hides other tenants' photos", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    const { photoId } = await (await upload(project.id, await staffToken(tenant.id), png)).json();
    const outsider = await staffToken((await createTestTenant()).id);

    expect((await download(request(outsider), params(project.id, photoId))).status).toBe(404);
    expect((await list(request(outsider), projectParams(project.id))).status).toBe(404);
    const deleted = await DELETE(
      request(outsider, { method: "DELETE" }),
      params(project.id, photoId),
    );
    expect(deleted.status).toBe(404);
    expect(files.size).toBe(1);
  });

  it("requires authentication", async () => {
    const res = await list(new Request("http://localhost/api/v1/projects/x/photos"), projectParams("x"));
    expect(res.status).toBe(401);
  });
});
