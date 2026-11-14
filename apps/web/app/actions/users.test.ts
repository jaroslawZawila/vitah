import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { signInAs } from "../../test/session";
import { changePasswordAction, getUsers, resetUserPasswordAction, setLanguageAction } from "./users";
import { TO_FORBIDDEN, TO_LOGIN } from "../../test/navigation";

vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// NextAuth's own sign-in and sign-out (they need a request): the action only calls them.
vi.mock("@repo/auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("../../auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
const { revalidatePath } = await import("next/cache");
const { AuthError } = await import("@repo/auth");
const { signIn, signOut } = await import("../../auth");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const reload = async (id: string) => (await db.query.users.findFirst({ where: eq(users.id, id) }))!;
const hasPassword = async (id: string, password: string) =>
  bcrypt.compare(password, (await reload(id)).passwordHash!);

const languageOf = async (id: string) =>
  (await db.query.users.findFirst({ where: eq(users.id, id) }))?.language;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(signIn).mockReset();
  vi.mocked(signOut).mockReset();
});

describe("getUsers", () => {
  it("lists the tenant's staff for an admin: no clients, nobody else's", async () => {
    const tenant = await createTestTenant();
    const admin = await createTestUser(tenant.id, { role: "admin" });
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    await createTestUser(tenant.id, { role: "client" });
    await createTestUser((await createTestTenant()).id, { role: "admin" });
    signInAs({ tenantId: tenant.id, userId: admin.id, role: "admin" });

    const list = await getUsers();

    expect(list.map((u) => u.id).sort()).toEqual([admin.id, viewer.id].sort());
    expect(list[0]).not.toHaveProperty("passwordHash");
  });

  it.each(["manager", "viewer"] as const)("is \"No tienes permiso\" for a %s, not an empty list", async (role) => {
    const tenant = await createTestTenant();
    const user = await createTestUser(tenant.id, { role });
    signInAs({ tenantId: tenant.id, userId: user.id, role });

    await expect(getUsers()).rejects.toEqual(TO_FORBIDDEN);
  });

  it("is the login page when signed out", async () => {
    signInAs(null);

    await expect(getUsers()).rejects.toEqual(TO_LOGIN);
  });

  it("lets an unexpected failure through, to the error page", async () => {
    const tenant = await createTestTenant();
    signInAs({ tenantId: tenant.id, userId: "u", role: "admin" });
    const { usersService } = await import("@repo/core");
    const failing = vi.spyOn(usersService, "listUsers").mockRejectedValue(new Error("database down"));

    await expect(getUsers()).rejects.toThrow("database down");
    failing.mockRestore();
  });
});

describe("changePasswordAction", () => {
  const CURRENT = "old-pass";
  const NEXT = "CasaNordica26";

  async function viewer() {
    const tenant = await createTestTenant();
    const user = await createTestUser(tenant.id, { role: "viewer", password: CURRENT, email: "vera@example.com" });
    signInAs({ tenantId: tenant.id, userId: user.id, role: "viewer" });
    return { tenant, user };
  }

  it("changes the caller's password and signs this browser in again with the new one", async () => {
    const { user } = await viewer();

    expect(await changePasswordAction(form({ currentPassword: CURRENT, newPassword: NEXT }))).toEqual({
      success: true,
    });

    expect(await hasPassword(user.id, NEXT)).toBe(true);
    // Every session from before is revoked, so this one is replaced by a new one.
    expect((await reload(user.id)).passwordChangedAt).toBeInstanceOf(Date);
    expect(signIn).toHaveBeenCalledExactlyOnceWith("credentials", {
      email: "vera@example.com",
      password: NEXT,
      redirect: false,
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong_password", { currentPassword: "not-this-one", newPassword: NEXT }],
    ["weak_password", { currentPassword: CURRENT, newPassword: "short" }],
    ["missing_fields", { newPassword: NEXT }],
  ])("returns %s as form state, leaving the password and the session alone", async (error, fields) => {
    const { user } = await viewer();

    expect(await changePasswordAction(form(fields as Record<string, string>))).toEqual({ error });

    expect(await hasPassword(user.id, CURRENT)).toBe(true);
    expect((await reload(user.id)).passwordChangedAt).toBeNull();
    expect(signIn).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("refuses the same password again", async () => {
    const tenant = await createTestTenant();
    const user = await createTestUser(tenant.id, { role: "manager", password: NEXT });
    signInAs({ tenantId: tenant.id, userId: user.id, role: "manager" });

    expect(await changePasswordAction(form({ currentPassword: NEXT, newPassword: NEXT }))).toEqual({
      error: "same_password",
    });
    expect((await reload(user.id)).passwordChangedAt).toBeNull();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("signs the browser out, and says so, when it can't be signed in again", async () => {
    const { user } = await viewer();
    vi.mocked(signIn).mockRejectedValue(new AuthError("too_many_attempts"));

    expect(await changePasswordAction(form({ currentPassword: CURRENT, newPassword: NEXT }))).toEqual({
      success: true,
      signedOut: true,
    });

    expect(await hasPassword(user.id, NEXT)).toBe(true);
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ redirect: false });
  });

  it("logs an unexpected failure to sign in again as one line, without the error's own text", async () => {
    const { user } = await viewer();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = Object.assign(new TypeError(`fetch failed for ${user.email}`), { email: user.email, password: NEXT });
    vi.mocked(signIn).mockRejectedValue(boom);

    expect(await changePasswordAction(form({ currentPassword: CURRENT, newPassword: NEXT }))).toEqual({
      success: true,
      signedOut: true,
    });

    expect(logged).toHaveBeenCalledTimes(1);
    const line = logged.mock.calls[0]![0] as string;
    expect(JSON.parse(line)).toEqual({
      level: "error",
      time: expect.any(String),
      event: "users.password_resignin_failed",
      userId: user.id,
      errorName: "TypeError",
    });
    expect(line).not.toContain(user.email);
    expect(line).not.toContain(NEXT);
    logged.mockRestore();
  });

  it("logs nothing when the sign-in was refused, as expected", async () => {
    await viewer();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(signIn).mockRejectedValue(new AuthError("too_many_attempts"));

    await changePasswordAction(form({ currentPassword: CURRENT, newPassword: NEXT }));

    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("only ever changes the caller's own password", async () => {
    const { tenant, user } = await viewer();
    const other = await createTestTenant();
    const colleague = await createTestUser(tenant.id, { role: "admin", password: CURRENT });
    // A session naming a tenant the user isn't in.
    signInAs({ tenantId: other.id, userId: user.id, role: "viewer" });

    expect(await changePasswordAction(form({ currentPassword: CURRENT, newPassword: NEXT }))).toEqual({
      error: "not_found",
    });
    expect(await hasPassword(user.id, CURRENT)).toBe(true);
    expect(await hasPassword(colleague.id, CURRENT)).toBe(true);
  });

  it("needs a signed-in staff member", async () => {
    signInAs(null);

    await expect(
      changePasswordAction(form({ currentPassword: CURRENT, newPassword: NEXT })),
    ).rejects.toEqual(TO_LOGIN);
  });
});

describe("resetUserPasswordAction", () => {
  const NEXT = "CasaNordica26";

  async function setup() {
    const tenant = await createTestTenant();
    const admin = await createTestUser(tenant.id, { role: "admin" });
    const viewer = await createTestUser(tenant.id, { role: "viewer", password: "old-pass" });
    signInAs({ tenantId: tenant.id, userId: admin.id, role: "admin" });
    return { tenant, admin, viewer };
  }

  it("lets an admin set a staff user's password, signing that user out", async () => {
    const { admin, viewer } = await setup();

    expect(await resetUserPasswordAction(viewer.id, form({ password: NEXT }))).toEqual({});

    expect(await hasPassword(viewer.id, NEXT)).toBe(true);
    expect((await reload(viewer.id)).passwordChangedAt).toBeInstanceOf(Date);
    expect((await reload(admin.id)).passwordChangedAt).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users");
    // The admin's own session is not touched.
    expect(signIn).not.toHaveBeenCalled();
  });

  it.each(["manager", "viewer"] as const)("is forbidden to a %s", async (role) => {
    const { tenant, admin, viewer } = await setup();
    signInAs({ tenantId: tenant.id, userId: admin.id, role });

    expect(await resetUserPasswordAction(viewer.id, form({ password: NEXT }))).toEqual({ error: "forbidden" });
    expect(await hasPassword(viewer.id, "old-pass")).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("finds no user of another tenant, and no client", async () => {
    const { tenant } = await setup();
    const other = await createTestTenant();
    const stranger = await createTestUser(other.id, { role: "viewer", password: "old-pass" });
    const client = await createTestUser(tenant.id, { role: "client", password: "old-pass" });

    expect(await resetUserPasswordAction(stranger.id, form({ password: NEXT }))).toEqual({ error: "not_found" });
    expect(await resetUserPasswordAction(client.id, form({ password: NEXT }))).toEqual({ error: "not_found" });
    expect(await hasPassword(stranger.id, "old-pass")).toBe(true);
    expect(await hasPassword(client.id, "old-pass")).toBe(true);
  });

  it("is not for the admin's own password, and takes no weak one", async () => {
    const { admin, viewer } = await setup();

    expect(await resetUserPasswordAction(admin.id, form({ password: NEXT }))).toEqual({
      error: "cannot_reset_own_password",
    });
    expect(await resetUserPasswordAction(viewer.id, form({ password: "short" }))).toEqual({
      error: "weak_password",
    });
    expect(await resetUserPasswordAction(viewer.id, form({}))).toEqual({ error: "weak_password" });
    expect(await hasPassword(viewer.id, "old-pass")).toBe(true);
  });

  it("needs a signed-in staff member", async () => {
    signInAs(null);

    await expect(resetUserPasswordAction("u-1", form({ password: NEXT }))).rejects.toEqual(TO_LOGIN);
  });
});

describe("setLanguageAction", () => {
  it("saves the caller's language and re-renders the portal", async () => {
    const tenant = await createTestTenant();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    signInAs({ tenantId: tenant.id, userId: viewer.id, role: "viewer" });

    expect(await setLanguageAction("en")).toEqual({});
    expect(await languageOf(viewer.id)).toBe("en");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses a language the portal doesn't have", async () => {
    const tenant = await createTestTenant();
    const admin = await createTestUser(tenant.id, { role: "admin" });
    signInAs({ tenantId: tenant.id, userId: admin.id, role: "admin" });

    expect(await setLanguageAction("fr" as "en")).toEqual({ error: "invalid_language" });
    expect(await languageOf(admin.id)).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("needs a signed-in staff member", async () => {
    signInAs(null);
    await expect(setLanguageAction("en")).rejects.toEqual(TO_LOGIN);
  });
});
