import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import { warrantyService } from "@repo/core";
import { files, testImage } from "@repo/core/testing";
import { GET as list } from "./route";
import { GET as one, PATCH } from "./[claimId]/route";
import { GET as photo } from "./[claimId]/photos/[photoId]/route";

// Bearer requests never read the NextAuth session, and next-auth itself
// can't load outside Next.js.
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

async function staffToken(tenantId: string, role: "manager" | "viewer" = "manager") {
  const user = await createTestUser(tenantId, { role });
  return createMobileToken({ sub: user.id, email: user.email, name: user.name, role, tenantId });
}

function request(token: string, init: { method?: string; json?: unknown; query?: string } = {}) {
  return new Request(`http://localhost/api/v1/projects/x/warranty${init.query ?? ""}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.json ? { "Content-Type": "application/json" } : {}) },
    body: init.json ? JSON.stringify(init.json) : undefined,
  });
}

/** A handed-over home whose client sent a claim with a photo. */
async function setup() {
  const tenant = await createTestTenant();
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id, obraStage: 8 });
  const { claimId } = await warrantyService.createClientClaim(tenant.id, client.id, project.id, {
    kind: "carpentry",
    room: "bedroom",
    description: "La puerta del armario no cierra.",
  });
  const { photoId } = await warrantyService.addClientClaimPhoto(tenant.id, client.id, claimId, { file: jpeg });
  return { tenant, project, claimId, photoId };
}

describe("/api/v1/projects/:id/warranty", () => {
  it("lists a project's claims, opens one with its photo, and answers it", async () => {
    const { tenant, project, claimId, photoId } = await setup();
    const token = await staffToken(tenant.id);

    const listed = await (await list(request(token), { params: Promise.resolve({ id: project.id }) })).json();
    expect(listed).toMatchObject({ handedOver: true, claims: [{ id: claimId, number: 1, status: "received", photoCount: 1 }] });

    const at = { params: Promise.resolve({ id: project.id, claimId }) };
    const changed = await PATCH(request(token, { method: "PATCH", json: { status: "scheduled", visitOn: "2026-12-10", answer: "Iremos el jueves." } }), at);
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ claimId });

    const claim = await (await one(request(token), at)).json();
    expect(claim).toMatchObject({ status: "scheduled", visitOn: "2026-12-10", answer: "Iremos el jueves.", photoIds: [photoId] });
    expect(claim.events.map((e: { action: string }) => e.action)).toEqual(["created", "photo_added", "updated"]);

    const image = await photo(request(token, { query: "?size=thumb" }), { params: Promise.resolve({ id: project.id, claimId, photoId }) });
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
  });

  it("says what is wrong with a change, and lets viewers only read", async () => {
    const { tenant, project, claimId } = await setup();
    const at = { params: Promise.resolve({ id: project.id, claimId }) };

    const noDay = await PATCH(request(await staffToken(tenant.id), { method: "PATCH", json: { status: "scheduled" } }), at);
    expect(noDay.status).toBe(400);
    expect(await noDay.json()).toEqual({ error: "visit_required" });

    const viewer = await staffToken(tenant.id, "viewer");
    expect((await one(request(viewer), at)).status).toBe(200);
    const denied = await PATCH(request(viewer, { method: "PATCH", json: { status: "in_review" } }), at);
    expect(denied.status).toBe(403);
  });

  it("never shows another tenant's claims, nor a client's token", async () => {
    const { project, claimId, tenant } = await setup();
    const other = await createTestTenant();
    const stranger = await staffToken(other.id);
    expect((await list(request(stranger), { params: Promise.resolve({ id: project.id }) })).status).toBe(404);
    expect((await one(request(stranger), { params: Promise.resolve({ id: project.id, claimId }) })).status).toBe(404);

    const client = await createTestUser(tenant.id, { role: "client" });
    const clientToken = await createMobileToken({ sub: client.id, email: client.email, name: client.name, role: "client", tenantId: tenant.id });
    expect((await list(request(clientToken), { params: Promise.resolve({ id: project.id }) })).status).toBe(401);
  });
});
