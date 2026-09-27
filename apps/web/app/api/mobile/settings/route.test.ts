import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import { db, pushTokens } from "@repo/db";
import { GET, PUT } from "./route";
import { POST as changePassword } from "../password/route";
import { DELETE as removeToken, POST as registerToken } from "../push-token/route";

// lib/api also serves /api/v1, which can read the NextAuth session; next-auth
// itself can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

const TOKEN = "ExponentPushToken[phone-1]";

function request(token: string | undefined, method = "GET", body?: unknown) {
  return new Request("http://localhost/api/mobile/x", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signedInClient() {
  const tenant = await createTestTenant();
  const client = await createTestUser(tenant.id, { role: "client", password: "vitah2026" });
  return createMobileToken({
    sub: client.id,
    email: client.email,
    name: client.name,
    role: "client",
    tenantId: tenant.id,
  });
}

beforeEach(resetDatabase);

describe("/api/mobile/settings", () => {
  it("reads and updates the client's settings", async () => {
    const token = await signedInClient();

    const initial = await GET(request(token));
    expect(await initial.json()).toEqual({
      notifications: { progress: true, documents: true, messages: true },
    });

    const updated = await PUT(request(token, "PUT", { notifications: { messages: false } }));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      notifications: { progress: true, documents: true, messages: false },
    });
  });

  it("rejects invalid settings", async () => {
    const res = await PUT(
      request(await signedInClient(), "PUT", { notifications: { progress: "yes" } }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_settings" });
  });

  it("requires a signed-in client", async () => {
    expect((await GET(request(undefined))).status).toBe(401);
  });
});

describe("POST /api/mobile/password", () => {
  it("changes the password", async () => {
    const res = await changePassword(
      request(await signedInClient(), "POST", {
        currentPassword: "vitah2026",
        newPassword: "CasaNordica26",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, token: expect.any(String) });
    // The fresh token keeps this phone signed in.
    expect((await GET(request(body.token))).status).toBe(200);
  });

  it("signs out phones holding a token from before the change", async () => {
    // Signed in a minute ago.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() - 60_000 });
    const old = await signedInClient();
    vi.useRealTimers();
    expect((await GET(request(old))).status).toBe(200);

    const res = await changePassword(
      request(old, "POST", { currentPassword: "vitah2026", newPassword: "CasaNordica26" }),
    );

    expect(res.status).toBe(200);
    // Requests already in flight still pass for a few seconds, then it's refused.
    expect((await GET(request(old))).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 31_000 });
    expect((await GET(request(old))).status).toBe(401);
    vi.useRealTimers();
  });

  it("answers 429 after too many wrong current passwords", async () => {
    const token = await signedInClient();
    const attempt = (currentPassword: string) =>
      changePassword(request(token, "POST", { currentPassword, newPassword: "CasaNordica26" }));
    for (let i = 0; i < 10; i++) expect((await attempt(`guess-${i}`)).status).toBe(400);

    const res = await attempt("vitah2026");

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "too_many_attempts" });
  });

  it("answers a wrong current password with 400, not 401", async () => {
    const res = await changePassword(
      request(await signedInClient(), "POST", {
        currentPassword: "wrong",
        newPassword: "CasaNordica26",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "wrong_password" });
  });
});

describe("/api/mobile/push-token", () => {
  it("registers and removes the phone", async () => {
    const token = await signedInClient();

    const registered = await registerToken(request(token, "POST", { token: TOKEN, language: "en" }));
    expect(registered.status).toBe(200);
    expect(await db.select().from(pushTokens)).toEqual([
      expect.objectContaining({ token: TOKEN, language: "en" }),
    ]);

    expect((await removeToken(request(token, "DELETE", { token: TOKEN }))).status).toBe(200);
    expect(await db.select().from(pushTokens)).toHaveLength(0);
  });

  it("rejects a malformed token", async () => {
    const res = await registerToken(request(await signedInClient(), "POST", { token: "x" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_token" });
  });
});
