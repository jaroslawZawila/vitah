import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, loginAttempts } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { SIGN_IN_LIMITS } from "@repo/core";
import { THROTTLE_WINDOW_MS } from "@repo/core/throttle";
import {
  attemptSignIn,
  clientIp,
  jwtIssuedAt,
  PASSWORD_CHANGE_GRACE_MS,
  revokedByPasswordChange,
  verifyCredentials,
} from "../src/credentials";

beforeEach(async () => {
  await resetDatabase();
});

describe("verifyCredentials", () => {
  it("accepts staff on the portal", async () => {
    const tenant = await createTestTenant();
    const admin = await createTestUser(tenant.id, {
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      password: "portal-pass",
    });

    expect(await verifyCredentials("admin@example.com", "portal-pass", "portal")).toEqual({
      id: admin.id,
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      tenantId: tenant.id,
    });
  });

  it("accepts clients on mobile, ignoring email case and whitespace", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, {
      email: "ana@example.com",
      role: "client",
      password: "mobile-pass",
    });

    expect(await verifyCredentials(" Ana@Example.com ", "mobile-pass", "mobile")).toMatchObject({
      id: client.id,
      role: "client",
    });
  });

  it("rejects clients on the portal", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: "ana@example.com", role: "client", password: "pass-1234" });

    expect(await verifyCredentials("ana@example.com", "pass-1234", "portal")).toBeNull();
  });

  it.each(["admin", "manager", "viewer"] as const)("rejects %s users on mobile", async (role) => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: "staff@example.com", role, password: "pass-1234" });

    expect(await verifyCredentials("staff@example.com", "pass-1234", "mobile")).toBeNull();
  });

  it("finds the client when a staff user elsewhere shares the email", async () => {
    const staffTenant = await createTestTenant();
    await createTestUser(staffTenant.id, { email: "ana@example.com", role: "admin", password: "staff-pass" });
    const clientTenant = await createTestTenant();
    const client = await createTestUser(clientTenant.id, {
      email: "ana@example.com",
      role: "client",
      password: "client-pass",
    });

    expect(await verifyCredentials("ana@example.com", "client-pass", "mobile")).toMatchObject({
      id: client.id,
    });
    expect(await verifyCredentials("ana@example.com", "staff-pass", "portal")).toMatchObject({
      role: "admin",
    });
  });

  it("rejects a wrong password", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: "ana@example.com", role: "client", password: "right-pass" });

    expect(await verifyCredentials("ana@example.com", "wrong-pass", "mobile")).toBeNull();
  });

  it("rejects an unknown email", async () => {
    expect(await verifyCredentials("nobody@example.com", "whatever", "mobile")).toBeNull();
  });

  it("rejects an inactive user", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, {
      email: "ana@example.com",
      role: "client",
      password: "pass-1234",
      active: false,
    });

    expect(await verifyCredentials("ana@example.com", "pass-1234", "mobile")).toBeNull();
  });

  it("rejects a user of an inactive tenant", async () => {
    const tenant = await createTestTenant({ active: false });
    await createTestUser(tenant.id, { email: "admin@example.com", role: "admin", password: "pass-1234" });

    expect(await verifyCredentials("admin@example.com", "pass-1234", "portal")).toBeNull();
  });
});

describe("passwords from before the 10-character policy", () => {
  // The policy is checked when a password is set, never at sign-in: nobody is
  // forced to change the one they have.
  it.each([
    ["portal", "admin"],
    ["mobile", "client"],
  ] as const)("still sign in to the %s", async (audience, role) => {
    const tenant = await createTestTenant();
    const user = await createTestUser(tenant.id, { email: "ana@example.com", role, password: "old-pass" });

    expect(await verifyCredentials("ana@example.com", "old-pass", audience)).toMatchObject({ id: user.id });
    expect(await attemptSignIn("ana@example.com", "old-pass", audience, "1.2.3.4")).toMatchObject({
      id: user.id,
    });
  });
});

describe("verifyCredentials on the portal", () => {
  it("ignores the email's case and whitespace", async () => {
    const tenant = await createTestTenant();
    const admin = await createTestUser(tenant.id, {
      email: "Admin@Example.com",
      role: "admin",
      password: "portal-pass",
    });

    expect(await verifyCredentials(" admin@example.COM ", "portal-pass", "portal")).toMatchObject({
      id: admin.id,
    });
  });
});

// The scheme is described in @repo/core/throttle (its counters are tested
// there); these run it with real passwords, for both sign-ins: staff on the
// portal and clients in the app share the code.
describe.each([
  ["portal", "admin"],
  ["mobile", "client"],
] as const)("attemptSignIn (%s)", (audience, role) => {
  const EMAIL = "ana@example.com";
  const other = audience === "portal" ? "mobile" : "portal";

  async function account(password = "right-pass") {
    const tenant = await createTestTenant();
    return createTestUser(tenant.id, { email: EMAIL, role, password });
  }

  const attempt = (password: string, ip: string | undefined, email = EMAIL) =>
    attemptSignIn(email, password, audience, ip);

  /** Wrong passwords: each answered null, or "too_many_attempts" once the IP is refused. */
  async function fail(times: number, ip: string | undefined, email = EMAIL) {
    for (let i = 0; i < times; i++) await attempt("wrong-pass", ip, email);
  }

  const otherIp = (i: number) => `10.0.${i >> 8}.${i & 255}`;

  it("signs in with the right password", async () => {
    const user = await account();

    expect(await attempt("right-pass", "1.2.3.4")).toMatchObject({ id: user.id });
  });

  it("refuses an IP hammering one email for the window, the right password included", async () => {
    await account();
    for (let i = 0; i < SIGN_IN_LIMITS.emailFromIp; i++) {
      expect(await attempt("wrong-pass", "6.6.6.6")).toBeNull();
    }

    expect(await attempt("wrong-pass", "6.6.6.6")).toBe("too_many_attempts");
    expect(await attempt("right-pass", "6.6.6.6")).toBe("too_many_attempts");
    // Other emails, and the other sign-in, are unaffected.
    expect(await attempt("x", "6.6.6.6", "bob@example.com")).toBeNull();
    expect(await attemptSignIn(EMAIL, "x", other, "6.6.6.6")).toBeNull();

    // Trying again doesn't prolong it: once the window has passed, it is let in.
    await db
      .update(loginAttempts)
      .set({ windowStart: new Date(Date.now() - THROTTLE_WINDOW_MS - 1000) });
    expect(await attempt("right-pass", "6.6.6.6")).toMatchObject({ email: EMAIL });
  });

  it("doesn't lock the owner out, however many IPs fail for their email", async () => {
    const user = await account();
    // Twice the email's own limit, each address within its allowance: what
    // used to refuse the owner's right password for the window.
    const guessers = 2 * (SIGN_IN_LIMITS.email / SIGN_IN_LIMITS.emailFromIp);
    for (let i = 0; i < guessers; i++) await fail(SIGN_IN_LIMITS.emailFromIp, otherIp(i));

    expect(await attempt("right-pass", "1.2.3.4")).toMatchObject({ id: user.id });
    // The guessers stay refused, right password or not.
    expect(await attempt("right-pass", otherIp(0))).toBe("too_many_attempts");
  });

  it("gives each IP fewer guesses while the email is under attack", async () => {
    await account();
    const guessers = SIGN_IN_LIMITS.email / SIGN_IN_LIMITS.emailFromIp + 1;
    for (let i = 0; i < guessers; i++) await fail(SIGN_IN_LIMITS.emailFromIp, otherIp(i));

    await fail(SIGN_IN_LIMITS.emailFromIpUnderAttack, "7.7.7.7");
    expect(await attempt("right-pass", "7.7.7.7")).toBe("too_many_attempts");
  });

  it("refuses an IP after too many failures across emails", async () => {
    await account();
    for (let i = 0; i < SIGN_IN_LIMITS.ip; i++) {
      await attempt("x", "9.9.9.9", `guess-${i}@example.com`);
    }

    expect(await attempt("right-pass", "9.9.9.9")).toBe("too_many_attempts");
    expect(await attempt("right-pass", "8.8.8.8")).toMatchObject({ email: EMAIL });
  });

  it("answers an unknown email like a wrong password, and counts both", async () => {
    await account();

    expect(await attempt("wrong-pass", "6.6.6.6")).toBeNull();
    expect(await attempt("wrong-pass", "6.6.6.6", "nobody@example.com")).toBeNull();
    await fail(SIGN_IN_LIMITS.emailFromIp - 1, "6.6.6.6");
    await fail(SIGN_IN_LIMITS.emailFromIp - 1, "6.6.6.6", "nobody@example.com");

    expect(await attempt("wrong-pass", "6.6.6.6")).toBe("too_many_attempts");
    expect(await attempt("wrong-pass", "6.6.6.6", "nobody@example.com")).toBe("too_many_attempts");
  });

  it("counts failures only: signing in again and again is never refused", async () => {
    const user = await account();

    for (let i = 0; i < SIGN_IN_LIMITS.emailFromIp + 5; i++) {
      expect(await attempt("right-pass", "1.2.3.4")).toMatchObject({ id: user.id });
    }
  });

  it("counts parallel attempts too", async () => {
    await account();
    const results = await Promise.all(
      Array.from({ length: 3 * SIGN_IN_LIMITS.emailFromIp }, () => attempt("wrong-pass", "7.7.7.7")),
    );

    expect(results.filter((r) => r === null)).toHaveLength(SIGN_IN_LIMITS.emailFromIp);
  });

  it("counts the email in any case", async () => {
    await account();
    await fail(SIGN_IN_LIMITS.emailFromIp, "6.6.6.6", "ANA@example.com");

    expect(await attempt("right-pass", "6.6.6.6")).toBe("too_many_attempts");
  });

  it("forgets the IP's failures for the email after a successful sign-in", async () => {
    await account();
    await fail(SIGN_IN_LIMITS.emailFromIp - 1, "1.2.3.4");
    await attempt("right-pass", "1.2.3.4");
    await fail(SIGN_IN_LIMITS.emailFromIp - 1, "1.2.3.4");

    expect(await attempt("right-pass", "1.2.3.4")).toMatchObject({ email: EMAIL });
  });

  it("without an IP, shares the email-wide allowance between the callers: ten junk attempts don't lock the owner out", async () => {
    await account();
    await fail(SIGN_IN_LIMITS.emailFromIp + 1, undefined);

    expect(await attempt("right-pass", undefined)).toMatchObject({ email: EMAIL });

    // A hundred failures in the window do, for the callers without an IP only.
    await fail(SIGN_IN_LIMITS.email - SIGN_IN_LIMITS.emailFromIp - 1, undefined);
    expect(await attempt("right-pass", undefined)).toBe("too_many_attempts");
    expect(await attempt("right-pass", "1.2.3.4")).toMatchObject({ email: EMAIL });
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost/", { headers });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("on Vercel, takes the address the edge wrote, never x-forwarded-for", () => {
    vi.stubEnv("VERCEL", "1");

    expect(
      clientIp(
        req({ "x-vercel-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" }),
      ),
    ).toBe("1.1.1.1");
    expect(clientIp(req({ "x-real-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" }))).toBe("2.2.2.2");
    expect(clientIp(req({ "x-forwarded-for": "3.3.3.3" }))).toBeUndefined();
  });

  it("elsewhere, takes x-real-ip, then what the nearest proxy appended to x-forwarded-for", () => {
    vi.stubEnv("VERCEL", "");

    expect(clientIp(req({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    // The first entry is whatever the client claimed.
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 2.2.2.2 , 3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientIp(req({ "x-vercel-forwarded-for": "6.6.6.6" }))).toBeUndefined();
  });

  it("is undefined without a header or a request", () => {
    expect(clientIp(req({}))).toBeUndefined();
    expect(clientIp(undefined)).toBeUndefined();
  });
});

describe("revokedByPasswordChange", () => {
  const CHANGED = Date.parse("2026-11-14T10:00:00.500Z");
  const GRACE = PASSWORD_CHANGE_GRACE_MS;
  const changed = new Date(CHANGED);

  it.each<[string, number | undefined, Date | null, number, boolean]>([
    // issued before the change
    ["issued before the change, the moment it is made", CHANGED - 60_000, changed, CHANGED, false],
    ["issued before, inside the grace", CHANGED - 60_000, changed, CHANGED + GRACE - 1, false],
    ["issued before, as the grace ends", CHANGED - 60_000, changed, CHANGED + GRACE, true],
    ["issued before, long after the grace", CHANGED - 60_000, changed, CHANGED + 86_400_000, true],
    ["issued a millisecond before, after the grace", CHANGED - 1, changed, CHANGED + GRACE, true],
    // the very instant of the change
    ["issued in the millisecond of the change, inside the grace", CHANGED, changed, CHANGED + 1, false],
    ["issued in the millisecond of the change, after the grace", CHANGED, changed, CHANGED + GRACE, true],
    // issued after the change
    ["issued a millisecond after the change, inside the grace", CHANGED + 1, changed, CHANGED + 2, false],
    ["issued a millisecond after, after the grace", CHANGED + 1, changed, CHANGED + GRACE, false],
    ["issued after, long after the grace", CHANGED + 5000, changed, CHANGED + 86_400_000, false],
    // a password that never changed
    ["never changed", CHANGED - 60_000, null, CHANGED + GRACE, false],
    ["never changed, no issue time", undefined, null, CHANGED + GRACE, false],
    // no issue time: older than any change
    ["no issue time, inside the grace", undefined, changed, CHANGED + GRACE - 1, false],
    ["no issue time, after the grace", undefined, changed, CHANGED + GRACE, true],
    // a clock behind the database's: the change is not in the past yet
    ["checked before the change it predates", CHANGED - 60_000, changed, CHANGED - 1000, false],
  ])("%s", (_case, issuedAt, passwordChangedAt, now, revoked) => {
    expect(revokedByPasswordChange(issuedAt, passwordChangedAt, now)).toBe(revoked);
  });

  it("takes a JWT's whole-second iat as the end of its second: one minted right after the change is kept", () => {
    const second = Math.floor(CHANGED / 1000);
    const later = CHANGED + GRACE;

    expect(jwtIssuedAt(undefined)).toBeUndefined();
    // Same second as the change (which was at .500): before or after it, nobody can tell.
    expect(revokedByPasswordChange(jwtIssuedAt(second), changed, later)).toBe(false);
    expect(revokedByPasswordChange(jwtIssuedAt(second + 1), changed, later)).toBe(false);
    expect(revokedByPasswordChange(jwtIssuedAt(second - 1), changed, later)).toBe(true);
    // A change on the second itself revokes what the second before issued, not its own.
    const onTheSecond = new Date(second * 1000);
    expect(revokedByPasswordChange(jwtIssuedAt(second - 1), onTheSecond, later)).toBe(true);
    expect(revokedByPasswordChange(jwtIssuedAt(second), onTheSecond, later)).toBe(false);
  });
});
