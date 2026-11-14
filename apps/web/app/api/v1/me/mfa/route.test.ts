import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, userMfa } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase, withoutTable } from "@repo/db/testing";
import { base32Decode, totp } from "@repo/core/totp";
import { apiRequest, clientToken, staffToken } from "../../../../../test/api";
import { DELETE as removeMfa } from "../../users/[id]/mfa/route";
import { GET as users } from "../../users/route";
import { GET as me } from "../route";
import { POST as begin } from "./begin/route";
import { POST as confirm } from "./confirm/route";
import { POST as disable } from "./disable/route";
import { POST as recoveryCodes } from "./recovery-codes/route";
import { GET as status } from "./route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

const PASSWORD = "password123"; // createTestUser's
const post = (body?: unknown) => ({ method: "POST", body });
/** The app's code `steps` half-minutes from now. */
const appCode = (secret: string, steps = 0) => totp(base32Decode(secret)!, Date.now() + steps * 30_000);

/** A staff token whose user has two-step verification on. */
async function enrolledToken(tenantId: string, role: "admin" | "manager" | "viewer" = "viewer") {
  const issued = await staffToken(tenantId, role);
  const { secret } = (await (await begin(apiRequest(issued.token, post()))).json()) as { secret: string };
  // The code of the step before: this step's and the next one's are still to be used.
  const answer = await confirm(apiRequest(issued.token, post({ code: appCode(secret, -1) })));
  const { recoveryCodes: codes } = (await answer.json()) as { recoveryCodes: string[] };
  return { ...issued, secret, recoveryCodes: codes };
}

const row = (userId: string) => db.query.userMfa.findFirst({ where: eq(userMfa.userId, userId) });

beforeEach(async () => {
  await resetDatabase();
});

describe("/api/v1/me/mfa", () => {
  it("is off for a user who never enrolled", async () => {
    const tenant = await createTestTenant();
    const { token } = await staffToken(tenant.id, "viewer");

    const response = await status(apiRequest(token));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, recoveryCodesLeft: 0 });
  });

  it("enrols any staff user: begin gives the secret, confirm switches it on and gives the recovery codes", async () => {
    const tenant = await createTestTenant();
    const { token, user } = await staffToken(tenant.id, "viewer");

    const begun = await begin(apiRequest(token, post()));
    expect(begun.status).toBe(200);
    const enrolment = (await begun.json()) as { secret: string; uri: string; qr: string };
    expect(Object.keys(enrolment).sort()).toEqual(["qr", "secret", "uri"]);
    expect(enrolment.uri).toBe(
      `otpauth://totp/ViTAH:${encodeURIComponent(user.email)}?secret=${enrolment.secret}&issuer=ViTAH`,
    );
    // Not on yet.
    expect(await (await status(apiRequest(token))).json()).toEqual({ enabled: false, recoveryCodesLeft: 0 });

    const confirmed = await confirm(apiRequest(token, post({ code: appCode(enrolment.secret) })));

    expect(confirmed.status).toBe(200);
    const body = (await confirmed.json()) as { recoveryCodes: string[] };
    expect(Object.keys(body)).toEqual(["recoveryCodes"]);
    expect(body.recoveryCodes).toHaveLength(10);
    expect(await (await status(apiRequest(token))).json()).toEqual({ enabled: true, recoveryCodesLeft: 10 });
  });

  it.each([
    ["wrong_code", 400, { code: "000000" }],
    ["missing_fields", 400, {}],
    ["invalid_body", 400, ["123456"]],
  ])("confirm answers %s and switches nothing on", async (error, statusCode, body) => {
    const tenant = await createTestTenant();
    const { token, user } = await staffToken(tenant.id);
    await begin(apiRequest(token, post()));

    const response = await confirm(apiRequest(token, post(body)));

    expect(response.status).toBe(statusCode);
    expect(await response.json()).toEqual({ error });
    expect((await row(user.id))!.confirmedAt).toBeNull();
  });

  it("confirm answers 400 mfa_not_started without a begin, 409 once on; begin 409 once on", async () => {
    const tenant = await createTestTenant();
    const fresh = await staffToken(tenant.id);
    const on = await enrolledToken(tenant.id);

    const notStarted = await confirm(apiRequest(fresh.token, post({ code: "123456" })));
    expect([notStarted.status, await notStarted.json()]).toEqual([400, { error: "mfa_not_started" }]);
    const again = await confirm(apiRequest(on.token, post({ code: appCode(on.secret) })));
    expect([again.status, await again.json()]).toEqual([409, { error: "mfa_already_enabled" }]);
    const rebegun = await begin(apiRequest(on.token, post()));
    expect([rebegun.status, await rebegun.json()]).toEqual([409, { error: "mfa_already_enabled" }]);
  });

  it("answers 429 after ten wrong codes, the right one included", async () => {
    const tenant = await createTestTenant();
    const { token } = await staffToken(tenant.id);
    const { secret } = (await (await begin(apiRequest(token, post()))).json()) as { secret: string };
    for (let i = 0; i < 10; i++) {
      expect((await confirm(apiRequest(token, post({ code: "000000" })))).status).toBe(400);
    }

    const response = await confirm(apiRequest(token, post({ code: appCode(secret) })));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "too_many_attempts" });
  });

  it("disable needs the password and a code", async () => {
    const tenant = await createTestTenant();
    const { token, user, secret, recoveryCodes: codes } = await enrolledToken(tenant.id);

    for (const [error, body] of [
      ["wrong_password", { password: "NotThisOne26", code: appCode(secret) }],
      ["wrong_code", { password: PASSWORD, code: "000000" }],
      ["missing_fields", { password: PASSWORD }],
      ["missing_fields", { code: appCode(secret) }],
    ] as const) {
      const response = await disable(apiRequest(token, post(body)));
      expect([response.status, await response.json()]).toEqual([400, { error }]);
    }
    expect((await row(user.id))!.confirmedAt).not.toBeNull();

    const response = await disable(apiRequest(token, post({ password: PASSWORD, code: codes[0] })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(await row(user.id)).toBeUndefined();
    const off = await disable(apiRequest(token, post({ password: PASSWORD, code: codes[1] })));
    expect([off.status, await off.json()]).toEqual([400, { error: "mfa_not_enabled" }]);
  });

  it("recovery-codes replaces the old ones for a valid code", async () => {
    const tenant = await createTestTenant();
    const { token, secret, recoveryCodes: old } = await enrolledToken(tenant.id);

    const refused = await recoveryCodes(apiRequest(token, post({ code: "000000" })));
    expect([refused.status, await refused.json()]).toEqual([400, { error: "wrong_code" }]);
    const response = await recoveryCodes(apiRequest(token, post({ code: appCode(secret) })));

    expect(response.status).toBe(200);
    const { recoveryCodes: fresh } = (await response.json()) as { recoveryCodes: string[] };
    expect(fresh).toHaveLength(10);
    expect(fresh.filter((code) => old.includes(code))).toEqual([]);
    // An old one no longer asks for new ones; a new one does.
    expect((await recoveryCodes(apiRequest(token, post({ code: old[0] })))).status).toBe(400);
    expect((await recoveryCodes(apiRequest(token, post({ code: fresh[0] })))).status).toBe(200);
  });

  it("is each caller's own: one user's calls never touch a colleague's or another tenant's", async () => {
    const tenant = await createTestTenant();
    const laura = await enrolledToken(tenant.id, "admin");
    const marcos = await staffToken(tenant.id, "viewer");
    const stranger = await enrolledToken((await createTestTenant()).id, "admin");

    expect(await (await status(apiRequest(marcos.token))).json()).toEqual({ enabled: false, recoveryCodesLeft: 0 });
    // Laura's code does nothing for anyone else.
    for (const other of [marcos, stranger]) {
      const response = await disable(apiRequest(other.token, post({ password: PASSWORD, code: appCode(laura.secret) })));
      expect(response.status).toBe(400);
    }
    expect((await row(laura.user.id))!.confirmedAt).not.toBeNull();
    expect((await row(stranger.user.id))!.confirmedAt).not.toBeNull();
  });

  it("answers nothing secret once enrolled: not from itself, /me or the staff list", async () => {
    const tenant = await createTestTenant();
    const { token, user, secret } = await enrolledToken(tenant.id, "admin");
    const stored = (await row(user.id))!;

    const answers = await Promise.all(
      [
        await status(apiRequest(token)),
        await me(apiRequest(token)),
        await users(apiRequest(token)),
        await begin(apiRequest(token, post())),
        await confirm(apiRequest(token, post({ code: "000000" }))),
        await disable(apiRequest(token, post({ password: "NotThisOne26", code: "000000" }))),
        await recoveryCodes(apiRequest(token, post({ code: "000000" }))),
      ].map((response) => response.text()),
    );

    const said = answers.join("\n");
    for (const secretThing of [secret, stored.secret, ...stored.recoveryCodes.flatMap((c) => [c.hash, c.salt])]) {
      expect(said).not.toContain(secretThing);
    }
    expect(said).not.toMatch(/[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}/);
    expect(JSON.parse(answers[2]!)).toEqual([expect.objectContaining({ id: user.id, mfaEnabled: true })]);
  });

  it("needs a staff token: not a client's, and not none", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { role: "client" });
    const asClient = await clientToken(tenant.id, client.id, client.email);

    for (const token of [null, asClient]) {
      expect((await status(apiRequest(token))).status).toBe(401);
      expect((await begin(apiRequest(token, post()))).status).toBe(401);
      expect((await confirm(apiRequest(token, post({ code: "123456" })))).status).toBe(401);
      expect((await disable(apiRequest(token, post({ password: PASSWORD, code: "123456" })))).status).toBe(401);
      expect((await recoveryCodes(apiRequest(token, post({ code: "123456" })))).status).toBe(401);
    }
    expect(await row(client.id)).toBeUndefined();
  });
});

describe("/api/v1/me/mfa before its table is there (the portal deployed ahead of its SQL)", () => {
  it("answers 503 mfa_unavailable, never a 500, and the staff list says off for everyone", async () => {
    const tenant = await createTestTenant();
    const admin = await staffToken(tenant.id, "admin");
    const laura = await enrolledToken(tenant.id, "manager");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = { params: Promise.resolve({ id: laura.user.id }) };

    const { answers, listed } = await withoutTable("user_mfa", async () => ({
      answers: [
        await status(apiRequest(laura.token)),
        await begin(apiRequest(admin.token, post())),
        await confirm(apiRequest(admin.token, post({ code: "123456" }))),
        await disable(apiRequest(laura.token, post({ password: PASSWORD, code: appCode(laura.secret) }))),
        await recoveryCodes(apiRequest(laura.token, post({ code: appCode(laura.secret) }))),
        await removeMfa(apiRequest(admin.token, { method: "DELETE" }), id),
      ],
      listed: await users(apiRequest(admin.token)),
    }));

    for (const answer of answers) {
      expect(answer.status).toBe(503);
      expect(await answer.json()).toEqual({ error: "mfa_unavailable" });
    }
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { id: string; mfaEnabled: boolean }[]).map((u) => [u.id, u.mfaEnabled])).toEqual([
      [admin.user.id, false],
      [laura.user.id, false],
    ]);
    // Said in the logs as a warning each time, and never as an unexpected error.
    expect(warn.mock.calls.map(([line]) => (JSON.parse(line as string) as { event: string }).event)).toEqual(
      Array.from({ length: 7 }, () => "mfa.table_missing"),
    );
    expect(error).not.toHaveBeenCalled();

    // The table there: everything as it was, Laura's still on.
    expect(await (await status(apiRequest(laura.token))).json()).toEqual({ enabled: true, recoveryCodesLeft: 10 });
    expect(((await (await users(apiRequest(admin.token))).json()) as { mfaEnabled: boolean }[]).map((u) => u.mfaEnabled)).toEqual([false, true]);
    expect((await removeMfa(apiRequest(admin.token, { method: "DELETE" }), id)).status).toBe(200);
    expect(await row(laura.user.id)).toBeUndefined();
    warn.mockRestore();
    error.mockRestore();
  });
});
