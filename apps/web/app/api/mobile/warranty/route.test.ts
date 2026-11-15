import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import { db, eq, users } from "@repo/db";
import { files, testImage } from "@repo/core/testing";
import { GET as list, POST as create } from "./route";
import { GET as one } from "./[id]/route";
import { POST as cancel } from "./[id]/cancel/route";
import { POST as addPhoto } from "./[id]/photos/route";
import { GET as photo } from "./[id]/photos/[photoId]/route";

// lib/api also serves /api/v1, which can read the NextAuth session; next-auth
// itself can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

let jpeg: File;
beforeAll(async () => {
  jpeg = await testImage("jpeg", 300, 200);
});

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

const CLAIM = { kind: "electrical", room: "kitchen", description: "Salta el diferencial al encender el horno.", urgent: true };

function request(path: string, token?: string, init: { method?: string; body?: BodyInit; json?: unknown; key?: string } = {}) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.key) headers["Idempotency-Key"] = init.key;
  return new Request(`http://localhost/api/mobile/warranty${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
}

const params = <T extends Record<string, string>>(values: T) => ({ params: Promise.resolve(values) });

/** A handed-over home with its client signed in on the app. */
async function setup(stage = 8) {
  const tenant = await createTestTenant();
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id, obraStage: stage, completionDate: new Date("2026-06-30") });
  const token = await createMobileToken({ sub: client.id, email: client.email, name: client.name, role: "client", tenantId: tenant.id });
  return { tenant, client, project, token };
}

async function send(token: string, projectId: string, key?: string, body: unknown = CLAIM) {
  return create(request(`?projectId=${projectId}`, token, { method: "POST", json: body, key }));
}

describe("/api/mobile/warranty", () => {
  it("sends a claim with a photo, lists it and opens it", async () => {
    const { project, token } = await setup();

    const res = await send(token, project.id, "warranty-route-key-1");
    expect(res.status).toBe(200);
    const { claimId, number } = await res.json();
    expect(number).toBe(1);
    // A retry with the same key: the same claim.
    expect(await (await send(token, project.id, "warranty-route-key-1")).json()).toEqual({ claimId, number });

    const form = new FormData();
    form.set("file", jpeg);
    const added = await addPhoto(request(`/${claimId}/photos`, token, { method: "POST", body: form }), params({ id: claimId }));
    expect(added.status).toBe(200);
    const { photoId } = await added.json();

    const listed = await (await list(request(`?projectId=${project.id}`, token))).json();
    expect(listed.warranty).toMatchObject({ handedOver: true, handoverOn: "2026-06-30", handoverSource: "planned" });
    expect(listed.warranty.claims).toEqual([expect.objectContaining({ id: claimId, number: 1, status: "received", photoCount: 1, urgent: true })]);

    const detail = await (await one(request(`/${claimId}`, token), params({ id: claimId }))).json();
    expect(detail).toMatchObject({ id: claimId, photoIds: [photoId], events: [{ action: "created" }, { action: "photo_added" }] });

    const image = await photo(request(`/${claimId}/photos/${photoId}?size=thumb`, token), params({ id: claimId, photoId }));
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
    expect(image.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'self'");
  });

  it("answers every refusal as { error: code }", async () => {
    const early = await setup(7);
    const notYet = await send(early.token, early.project.id);
    expect(notYet.status).toBe(409);
    expect(await notYet.json()).toEqual({ error: "not_handed_over" });

    const { project, token } = await setup();
    const bad = await send(token, project.id, undefined, { ...CLAIM, room: "attic" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_input" });
    const notJson = await create(request(`?projectId=${project.id}`, token, { method: "POST", body: "nope" }));
    expect(await notJson.json()).toEqual({ error: "invalid_body" });

    for (let i = 0; i < 3; i++) await send(token, project.id);
    const capped = await send(token, project.id);
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: "too_many_claims_today" });

    const { claimId } = await (await list(request(`?projectId=${project.id}`, token))).json().then((r) => ({ claimId: r.warranty.claims[0].id }));
    const form = new FormData();
    form.set("file", new File(["not an image"], "a.jpg", { type: "image/jpeg" }));
    const notImage = await addPhoto(request(`/${claimId}/photos`, token, { method: "POST", body: form }), params({ id: claimId }));
    expect(notImage.status).toBe(400);
    expect(await notImage.json()).toEqual({ error: "invalid_file_type" });
  });

  it("cancels the client's claim, once nobody has started on it", async () => {
    const { project, token } = await setup();
    const { claimId } = await (await send(token, project.id)).json();

    const res = await cancel(request(`/${claimId}/cancel`, token, { method: "POST" }), params({ id: claimId }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimId });
    const detail = await (await one(request(`/${claimId}`, token), params({ id: claimId }))).json();
    expect(detail.status).toBe("cancelled");
  });

  it("keeps each client to their own homes and claims", async () => {
    const mine = await setup();
    const theirs = await setup();
    const { claimId } = await (await send(theirs.token, theirs.project.id)).json();

    const other = await send(mine.token, theirs.project.id);
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: "project_not_found" });
    expect((await one(request(`/${claimId}`, mine.token), params({ id: claimId }))).status).toBe(404);
    expect((await cancel(request(`/${claimId}/cancel`, mine.token, { method: "POST" }), params({ id: claimId }))).status).toBe(404);
    expect((await list(request(`?projectId=${theirs.project.id}`, mine.token))).status).toBe(404);
  });

  it("requires a valid token of an active client", async () => {
    const { client, project, token } = await setup();

    expect((await list(request(""))).status).toBe(401);
    expect((await send("garbage", project.id)).status).toBe(401);
    await db.update(users).set({ active: false }).where(eq(users.id, client.id));
    expect((await send(token, project.id)).status).toBe(401);
  });
});
