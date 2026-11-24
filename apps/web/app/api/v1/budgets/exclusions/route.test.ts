import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetService } from "@repo/core";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { apiRequest, clientToken, routeParams, staffToken } from "../../../../../test/api";
import { PATCH as PATCH_REVISION } from "../../projects/[id]/budget/revisions/[revisionId]/route";
import { DELETE, PATCH } from "./[presetId]/route";
import { GET, POST } from "./route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(resetDatabase);

type Preset = { id: string; label: string };
const list = async (token: string): Promise<Preset[]> => (await GET(apiRequest(token))).json();
const preset = (presetId: string) => routeParams({ presetId });

describe("/api/v1/budgets/exclusions", () => {
  it("lists the template's lines to any staff role; admins and managers add, edit and remove one", async () => {
    const tenant = await createTestTenant();
    const { token: manager } = await staffToken(tenant.id, "manager");
    const { token: viewer } = await staffToken(tenant.id, "viewer");

    const first = await list(viewer);
    expect(first.length).toBeGreaterThan(0);

    const created = await POST(apiRequest(manager, { method: "POST", body: { label: " Piscina " } }));
    expect(created.status).toBe(201);
    const piscina: Preset = await created.json();
    expect(piscina).toEqual({ id: expect.any(String), label: "Piscina" });

    const edited = await PATCH(apiRequest(manager, { method: "PATCH", body: { label: "Piscina y depuradora" } }), preset(piscina.id));
    expect(edited.status).toBe(200);
    expect(await edited.json()).toEqual({ id: piscina.id, label: "Piscina y depuradora" });
    const taken = await PATCH(apiRequest(manager, { method: "PATCH", body: { label: first[0]!.label } }), preset(piscina.id));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "exclusion_exists" });

    const removed = await DELETE(apiRequest(manager, { method: "DELETE" }), preset(first[0]!.id));
    expect(removed.status).toBe(200);
    expect((await list(viewer)).map((p) => p.label)).toEqual([...first.slice(1).map((p) => p.label), "Piscina y depuradora"]);
    expect((await DELETE(apiRequest(manager, { method: "DELETE" }), preset(first[0]!.id))).status).toBe(404);
  });

  it("refuses a viewer's change and a blank line", async () => {
    const tenant = await createTestTenant();
    const { token: viewer } = await staffToken(tenant.id, "viewer");
    const { token: admin } = await staffToken(tenant.id, "admin");
    const [line] = await list(admin);

    expect((await POST(apiRequest(viewer, { method: "POST", body: { label: "x" } }))).status).toBe(403);
    expect((await PATCH(apiRequest(viewer, { method: "PATCH", body: { label: "x" } }), preset(line!.id))).status).toBe(403);
    expect((await DELETE(apiRequest(viewer, { method: "DELETE" }), preset(line!.id))).status).toBe(403);
    const blank = await POST(apiRequest(admin, { method: "POST", body: { label: "  " } }));
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: "missing_fields" });
  });

  it("is each tenant's own, and needs a staff token", async () => {
    const tenant = await createTestTenant();
    const other = await createTestTenant();
    const { token } = await staffToken(tenant.id, "admin");
    const { token: stranger } = await staffToken(other.id, "admin");
    await POST(apiRequest(token, { method: "POST", body: { label: "Solo nuestra" } }));
    const ours = await list(token);

    expect((await list(stranger)).map((p) => p.label)).not.toContain("Solo nuestra");
    const mine = ours.find((p) => p.label === "Solo nuestra")!;
    expect((await PATCH(apiRequest(stranger, { method: "PATCH", body: { label: "x" } }), preset(mine.id))).status).toBe(404);
    expect((await DELETE(apiRequest(stranger, { method: "DELETE" }), preset(mine.id))).status).toBe(404);

    const client = await createTestUser(tenant.id, { role: "client" });
    expect((await GET(apiRequest(null))).status).toBe(401);
    expect((await GET(apiRequest(await clientToken(tenant.id, client.id, client.email)))).status).toBe(401);
  });

  it("ticks a line on a draft through the revision's PATCH, saving it to the library", async () => {
    const tenant = await createTestTenant();
    const { token, user } = await staffToken(tenant.id, "manager");
    const project = await createTestProject(tenant.id);
    const ctx = { tenantId: tenant.id, userId: user.id, role: "manager" as const };
    await budgetService.createBudget(ctx, project.id, {});
    const revisionId = (await budgetService.getBudget(ctx, project.id)).revision!.id;
    const params = routeParams({ id: project.id, revisionId });

    const res = await PATCH_REVISION(apiRequest(token, { method: "PATCH", body: { exclusion: { text: "Acometidas", included: true, save: true } } }), params);
    expect(res.status).toBe(200);
    expect((await budgetService.getBudget(ctx, project.id)).revision!.texts.exclusions.at(-1)).toBe("Acometidas");
    expect((await list(token)).map((p) => p.label)).toContain("Acometidas");

    const bad = await PATCH_REVISION(apiRequest(token, { method: "PATCH", body: { exclusion: { text: "", included: true } } }), params);
    expect(bad.status).toBe(400);
  });
});
