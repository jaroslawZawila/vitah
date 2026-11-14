import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, tenants, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { PASSWORD_CHANGE_GRACE_MS } from "../src/credentials";
import { createMobileToken } from "../src/mobile";
import { usersService } from "@repo/core";
import { refreshSessionToken, SESSION_RECHECK_MS, signedInToken } from "../src/session";

// context.ts reads the portal session through NextAuth's `auth()`.
const auth = vi.fn();
vi.mock("../src/index", () => ({ auth }));
const { getRequestContext, getSessionContext } = await import("../src/context");

beforeEach(async () => {
  await resetDatabase();
  auth.mockReset();
});

async function staff(role: "admin" | "manager" | "viewer" = "admin") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  return { tenant, user, token: { sub: user.id, tenantId: tenant.id, role } };
}

describe("refreshSessionToken", () => {
  it("keeps an active user's session, noting when it checked", async () => {
    const { token } = await staff();

    expect(await refreshSessionToken(token, 1000)).toEqual({ ...token, checkedAt: 1000 });
  });

  it("trusts a check made within the last minute, then checks again", async () => {
    const { user, token } = await staff();
    await db.update(users).set({ active: false }).where(eq(users.id, user.id));
    const checked = { ...token, checkedAt: 1000 };

    expect(await refreshSessionToken(checked, 1000 + SESSION_RECHECK_MS - 1)).toBe(checked);
    expect(await refreshSessionToken(checked, 1000 + SESSION_RECHECK_MS)).toBeNull();
  });

  it("applies a changed role at once", async () => {
    const { user, token } = await staff("admin");
    await db.update(users).set({ role: "viewer" }).where(eq(users.id, user.id));

    expect(await refreshSessionToken(token)).toMatchObject({ role: "viewer" });
  });

  it("ends the session of a deactivated user", async () => {
    const { user, token } = await staff();
    await db.update(users).set({ active: false }).where(eq(users.id, user.id));

    expect(await refreshSessionToken(token)).toBeNull();
  });

  it("ends the session when the tenant is deactivated", async () => {
    const { tenant, token } = await staff();
    await db.update(tenants).set({ active: false }).where(eq(tenants.id, tenant.id));

    expect(await refreshSessionToken(token)).toBeNull();
  });

  it("ends a session whose user moved to another tenant or became a client", async () => {
    const { user, token } = await staff();
    const other = await createTestTenant();

    expect(await refreshSessionToken({ ...token, tenantId: other.id })).toBeNull();
    await db.update(users).set({ role: "client" }).where(eq(users.id, user.id));
    expect(await refreshSessionToken(token)).toBeNull();
  });

  it("ends a session without a user", async () => {
    expect(await refreshSessionToken({})).toBeNull();
  });
});

describe("signedInToken", () => {
  it("notes who signed in and when", () => {
    expect(signedInToken({ sub: "u-1" }, { role: "manager", tenantId: "t-1" }, 5000)).toEqual({
      sub: "u-1",
      role: "manager",
      tenantId: "t-1",
      checkedAt: 5000,
      authAt: 5000,
    });
  });
});

describe("a session and the user's password", () => {
  const CHANGED = new Date("2026-11-14T10:00:00.000Z");
  /** A use of the session well after the change (and its grace). */
  const LATER = CHANGED.getTime() + 3_600_000;
  /** For real changes, made now: once their grace is over. */
  const afterGrace = () => Date.now() + PASSWORD_CHANGE_GRACE_MS + 1000;

  /** A staff member whose password last changed at CHANGED, and a session of theirs that signed in at `authAt`. */
  async function changedAt(authAt: number | undefined) {
    const { user, token } = await staff("manager");
    await db.update(users).set({ passwordChangedAt: CHANGED }).where(eq(users.id, user.id));
    return { user, token: { ...token, authAt } };
  }

  it("ends a session that signed in before the password changed", async () => {
    const { token } = await changedAt(CHANGED.getTime() - 1);

    expect(await refreshSessionToken(token, LATER)).toBeNull();
  });

  it("ends one from the very millisecond of the change", async () => {
    const { token } = await changedAt(CHANGED.getTime());

    expect(await refreshSessionToken(token, LATER)).toBeNull();
  });

  it("keeps a session that signed in after it", async () => {
    const { token } = await changedAt(CHANGED.getTime() + 1);

    expect(await refreshSessionToken(token, LATER)).toEqual({ ...token, checkedAt: LATER });
  });

  it("goes by when the session signed in, not by when its token was last rewritten", async () => {
    // NextAuth renews `iat` (and we `checkedAt`) on every use of the session.
    const { token } = await changedAt(CHANGED.getTime() - 1);

    expect(
      await refreshSessionToken({ ...token, iat: LATER / 1000, checkedAt: LATER }, LATER + SESSION_RECHECK_MS),
    ).toBeNull();
  });

  it("revokes within the re-check minute: a check from just before the change holds until then", async () => {
    const { token } = await changedAt(CHANGED.getTime() - 5000);
    const checked = { ...token, checkedAt: CHANGED.getTime() - 1 };

    expect(await refreshSessionToken(checked, CHANGED.getTime() + 1)).toBe(checked);
    expect(await refreshSessionToken(checked, checked.checkedAt + SESSION_RECHECK_MS - 1)).toBe(checked);
    expect(await refreshSessionToken(checked, checked.checkedAt + SESSION_RECHECK_MS)).toBeNull();
  });

  it("lets a revoked session pass for the grace only, never noting it as checked", async () => {
    // The browser that changed the password is still on its old session in that request.
    const { token } = await changedAt(CHANGED.getTime() - 5000);
    const stale = { ...token, checkedAt: CHANGED.getTime() - SESSION_RECHECK_MS };

    // Looked up on every use: the grace can't be stretched into another minute.
    expect(await refreshSessionToken(stale, CHANGED.getTime() + 1)).toBe(stale);
    expect(await refreshSessionToken(stale, CHANGED.getTime() + PASSWORD_CHANGE_GRACE_MS - 1)).toBe(stale);
    expect(await refreshSessionToken(stale, CHANGED.getTime() + PASSWORD_CHANGE_GRACE_MS)).toBeNull();
    expect(PASSWORD_CHANGE_GRACE_MS).toBeLessThan(SESSION_RECHECK_MS);
  });

  it("keeps a session from before sessions noted their sign-in, until the password changes", async () => {
    const { user, token } = await staff();

    expect(await refreshSessionToken(token, LATER)).toEqual({ ...token, checkedAt: LATER });
    await db.update(users).set({ passwordChangedAt: CHANGED }).where(eq(users.id, user.id));
    expect(await refreshSessionToken(token, LATER)).toBeNull();
  });

  it("ends every session of a user who changes their password; the next sign-in works", async () => {
    const tenant = await createTestTenant();
    const user = await createTestUser(tenant.id, { role: "viewer", password: "old-pass" });
    const ctx = { tenantId: tenant.id, userId: user.id, role: "viewer" as const };
    const session = (authAt: number) => signedInToken({ sub: user.id }, { role: "viewer", tenantId: tenant.id }, authAt);
    const before = { ...session(Date.now() - 60_000), checkedAt: 0 };

    expect(await refreshSessionToken(before)).not.toBeNull();
    await usersService.changeMyPassword(ctx, { currentPassword: "old-pass", newPassword: "CasaNordica26" });

    expect(await refreshSessionToken(before, afterGrace())).toBeNull();
    const changed = (await db.query.users.findFirst({ where: eq(users.id, user.id) }))!.passwordChangedAt!;
    const after = { ...session(changed.getTime() + 1), checkedAt: 0 };
    expect(await refreshSessionToken(after, afterGrace())).toMatchObject({ sub: user.id });
  });

  it("ends the sessions of a user whose password an admin resets, and only theirs", async () => {
    const { tenant, user: admin } = await staff("admin");
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const session = (id: string, role: "admin" | "viewer") => ({
      ...signedInToken({ sub: id }, { role, tenantId: tenant.id }, Date.now() - 60_000),
      checkedAt: 0,
    });

    await usersService.resetUserPassword(
      { tenantId: tenant.id, userId: admin.id, role: "admin" },
      viewer.id,
      { password: "CasaNordica26" },
    );

    expect(await refreshSessionToken(session(viewer.id, "viewer"), afterGrace())).toBeNull();
    expect(await refreshSessionToken(session(admin.id, "admin"), afterGrace())).toMatchObject({ sub: admin.id });
  });

  it("keeps a deactivated user's old sessions ended after they are activated again", async () => {
    const { tenant, user: admin } = await staff("admin");
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" as const };
    const session = (authAt: number) => ({
      ...signedInToken({ sub: viewer.id }, { role: "viewer", tenantId: tenant.id }, authAt),
      checkedAt: 0,
    });
    const old = session(Date.now() - 60_000);

    await usersService.updateUser(ctx, viewer.id, { active: false });
    // At once: no grace for a deactivated user.
    expect(await refreshSessionToken(old)).toBeNull();
    await usersService.updateUser(ctx, viewer.id, { active: true });
    expect(await refreshSessionToken(old, afterGrace())).toBeNull();

    expect(await refreshSessionToken(session(Date.now() + 1000), afterGrace())).toMatchObject({ sub: viewer.id });
  });
});

describe("getSessionContext", () => {
  it("builds the context from the session", async () => {
    const { user, tenant } = await staff("manager");
    auth.mockResolvedValue({ user: { id: user.id, tenantId: tenant.id, role: "manager" } });

    expect(await getSessionContext()).toEqual({
      tenantId: tenant.id,
      userId: user.id,
      role: "manager",
    });
  });

  it("is null without a session, or for a client", async () => {
    auth.mockResolvedValue(null);
    expect(await getSessionContext()).toBeNull();

    auth.mockResolvedValue({ user: { id: "u", tenantId: "t", role: "client" } });
    expect(await getSessionContext()).toBeNull();
  });
});

describe("getRequestContext with a Bearer token", () => {
  const bearer = (token: string) =>
    new Request("http://localhost/api/v1/projects", { headers: { authorization: `Bearer ${token}` } });

  async function tokenFor(user: { id: string; email: string; name: string | null }, tenantId: string, role: "admin" | "client") {
    return createMobileToken({ sub: user.id, email: user.email, name: user.name, role, tenantId });
  }

  it("uses the staff member's current role, not the token's", async () => {
    const { user, tenant } = await staff("viewer");
    const token = await tokenFor(user, tenant.id, "admin");

    expect(await getRequestContext(bearer(token))).toEqual({
      tenantId: tenant.id,
      userId: user.id,
      role: "viewer",
    });
  });

  it("rejects a deactivated staff member", async () => {
    const { user, tenant } = await staff();
    const token = await tokenFor(user, tenant.id, "admin");
    await db.update(users).set({ active: false }).where(eq(users.id, user.id));

    expect(await getRequestContext(bearer(token))).toBeNull();
  });

  it("rejects a token issued before the staff member's password changed", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() - 120_000 });
    const { user, tenant } = await staff();
    const token = await tokenFor(user, tenant.id, "admin");
    vi.useRealTimers();
    expect(await getRequestContext(bearer(token))).not.toBeNull();

    await db
      .update(users)
      .set({ passwordChangedAt: new Date(Date.now() - 60_000) })
      .where(eq(users.id, user.id));

    expect(await getRequestContext(bearer(token))).toBeNull();
    // One issued since is fine.
    expect(await getRequestContext(bearer(await tokenFor(user, tenant.id, "admin")))).toMatchObject({
      userId: user.id,
    });
  });

  it("still accepts it for the grace after the change, like a portal session and the app's token", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() - 120_000 });
    const { user, tenant } = await staff();
    const token = await tokenFor(user, tenant.id, "admin");
    vi.useRealTimers();
    const changed = Date.now();
    await db.update(users).set({ passwordChangedAt: new Date(changed) }).where(eq(users.id, user.id));

    expect(await getRequestContext(bearer(token))).toMatchObject({ userId: user.id });
    vi.useFakeTimers({ toFake: ["Date"], now: changed + PASSWORD_CHANGE_GRACE_MS - 1000 });
    expect(await getRequestContext(bearer(token))).toMatchObject({ userId: user.id });
    vi.useFakeTimers({ toFake: ["Date"], now: changed + PASSWORD_CHANGE_GRACE_MS });
    expect(await getRequestContext(bearer(token))).toBeNull();
    vi.useRealTimers();
  });

  it("rejects a client and an invalid token", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { role: "client" });

    expect(await getRequestContext(bearer(await tokenFor(client, tenant.id, "client")))).toBeNull();
    expect(await getRequestContext(bearer("not-a-jwt"))).toBeNull();
    expect(auth).not.toHaveBeenCalled();
  });
});
