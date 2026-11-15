import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, resetDatabase } from "@repo/db/testing";
import { apiRequest, staffToken } from "../../../../../test/api";
import { GET, PUT } from "./route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

beforeEach(async () => {
  await resetDatabase();
});

const office = { address: "Camargo, Cantabria", phone: "942 000 000", email: "hola@example.com", hours: "9:00 – 18:00" };

describe("/api/v1/tenant/contact", () => {
  it("is written by an admin and read by any staff", async () => {
    const tenant = await createTestTenant();
    const { token: admin } = await staffToken(tenant.id, "admin");
    const { token: viewer } = await staffToken(tenant.id, "viewer");

    const put = await PUT(apiRequest(admin, { method: "PUT", body: office }));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual(office);

    const got = await GET(apiRequest(viewer));
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(office);
  });

  it("refuses a manager's change and a bad email", async () => {
    const tenant = await createTestTenant();
    const { token: admin } = await staffToken(tenant.id, "admin");
    const { token: manager } = await staffToken(tenant.id, "manager");

    expect((await PUT(apiRequest(manager, { method: "PUT", body: office }))).status).toBe(403);
    const bad = await PUT(apiRequest(admin, { method: "PUT", body: { ...office, email: "nope" } }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_email" });
  });

  it("is each tenant's own, and needs a staff token", async () => {
    const tenant = await createTestTenant();
    const other = await createTestTenant();
    const { token: admin } = await staffToken(tenant.id, "admin");
    const { token: theirs } = await staffToken(other.id, "admin");
    await PUT(apiRequest(admin, { method: "PUT", body: office }));

    expect(await (await GET(apiRequest(theirs))).json()).toEqual({ address: null, phone: null, email: null, hours: null });
    expect((await GET(apiRequest(null))).status).toBe(401);
  });
});
