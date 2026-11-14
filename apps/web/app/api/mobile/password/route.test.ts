import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { verifyMobileToken } from "@repo/auth/mobile";
import { apiRequest, clientToken, staffToken } from "../../../../test/api";
import { POST } from "./route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

// The installed app builds call this as it was: same body, same answers.

const CURRENT = "vitah2026"; // from before the one policy
const NEXT = "CasaNordica26";

async function client() {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role: "client", password: CURRENT });
  return { tenant, user, token: await clientToken(tenant.id, user.id, user.email) };
}

const change = (token: string | null, body: unknown) => POST(apiRequest(token, { method: "POST", body }));

const hasPassword = async (id: string, password: string) =>
  bcrypt.compare(password, (await db.query.users.findFirst({ where: eq(users.id, id) }))!.passwordHash!);

beforeEach(async () => {
  await resetDatabase();
});

describe("POST /api/mobile/password", () => {
  it("changes the client's password and hands the phone a fresh token", async () => {
    const { user, token } = await client();

    const response = await change(token, { currentPassword: CURRENT, newPassword: NEXT });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, token: expect.any(String) });
    expect(await verifyMobileToken(body.token)).toMatchObject({ sub: user.id, role: "client" });
    expect(await hasPassword(user.id, NEXT)).toBe(true);
  });

  it.each([
    ["wrong_password", { currentPassword: "nope", newPassword: NEXT }],
    ["weak_password", { currentPassword: CURRENT, newPassword: "short1A" }],
    ["missing_fields", { newPassword: NEXT }],
  ])("answers 400 %s", async (error, body) => {
    const { user, token } = await client();

    const response = await change(token, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(await hasPassword(user.id, CURRENT)).toBe(true);
  });

  it("is for clients only", async () => {
    const { tenant } = await client();
    const { token } = await staffToken(tenant.id);

    expect((await change(token, { currentPassword: "password123", newPassword: NEXT })).status).toBe(401);
    expect((await change(null, { currentPassword: CURRENT, newPassword: NEXT })).status).toBe(401);
  });
});
