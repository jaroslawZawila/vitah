import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, resetDatabase } from "@repo/db/testing";
import { apiRequest, staffToken } from "../../../../test/api";
import { GET, PATCH } from "./route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

beforeEach(async () => {
  await resetDatabase();
});

describe("/api/v1/me", () => {
  it("reads and changes the caller's own language", async () => {
    const tenant = await createTestTenant();
    const { token, user } = await staffToken(tenant.id, "viewer");

    const before = await GET(apiRequest(token));
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ id: user.id, role: "viewer", language: null });

    const after = await PATCH(apiRequest(token, { method: "PATCH", body: { language: "en" } }));
    expect(after.status).toBe(200);
    expect(await after.json()).toMatchObject({ id: user.id, language: "en" });
    expect(await (await GET(apiRequest(token))).json()).toMatchObject({ language: "en" });
  });

  it("refuses a language the portal doesn't have", async () => {
    const tenant = await createTestTenant();
    const { token } = await staffToken(tenant.id);

    const response = await PATCH(apiRequest(token, { method: "PATCH", body: { language: "de" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_language" });
  });

  it("needs a staff token", async () => {
    expect((await GET(apiRequest(null))).status).toBe(401);
  });
});
