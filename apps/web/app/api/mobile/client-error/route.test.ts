import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, users } from "@repo/db";
import { clientToken } from "../../../../test/api";
import { POST } from "./route";

const log = vi.spyOn(console, "error").mockImplementation(() => {});

// The rate limit is per IP: each test reports from its own.
let ip = 0;
const nextIp = () => `203.0.113.${++ip}`;

function report(
  body: unknown,
  { token, from = nextIp(), headers = {}, post = POST }: { token?: string; from?: string; headers?: Record<string, string>; post?: typeof POST } = {},
) {
  return post(
    new Request("http://localhost/api/mobile/client-error", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-real-ip": from,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/** What was written to the log: the parsed line of each call. */
const lines = () => log.mock.calls.map(([line]) => JSON.parse(line as string) as Record<string, unknown>);

const crash = {
  message: "TypeError: undefined is not a function",
  stack: "TypeError: undefined is not a function\n    at PagoScreen (address at index.android.bundle:1:2345)",
  screen: "(app)/obra/pago/[id]",
  fatal: true,
  appVersion: "1.0.0",
  platform: "android",
  osVersion: "35",
  locale: "es-ES",
};

async function signedInClient() {
  const tenant = await createTestTenant();
  const client = await createTestUser(tenant.id, { role: "client", email: "ana@example.com" });
  return { tenant, client, token: await clientToken(tenant.id, client.id, client.email) };
}

beforeEach(async () => {
  await resetDatabase();
  log.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/mobile/client-error", () => {
  it("logs one line with who it happened to for a signed-in client", async () => {
    const { tenant, client, token } = await signedInClient();

    const res = await report(crash, { token });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(lines()).toEqual([
      {
        level: "error",
        time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
        event: "mobile.client_error",
        ...crash,
        authenticated: true,
        userId: client.id,
        tenantId: tenant.id,
      },
    ]);
  });

  it("logs a report sent without a token, e.g. a crash on the sign-in screen", async () => {
    const res = await report(crash);

    expect(res.status).toBe(204);
    expect(lines()).toEqual([expect.objectContaining({ ...crash, authenticated: false })]);
    expect(lines()[0]).not.toHaveProperty("userId");
    expect(lines()[0]).not.toHaveProperty("tenantId");
  });

  it.each(["not-a-token", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged"])(
    "logs a report with an invalid token as anonymous: %s",
    async (token) => {
      const res = await report(crash, { token });

      expect(res.status).toBe(204);
      expect(lines()).toEqual([expect.objectContaining({ message: crash.message, authenticated: false })]);
      expect(lines()[0]).not.toHaveProperty("userId");
    },
  );

  it("logs a deactivated client's report as anonymous", async () => {
    const { client, token } = await signedInClient();
    await db.update(users).set({ active: false }).where(eq(users.id, client.id));

    expect((await report(crash, { token })).status).toBe(204);
    expect(lines()).toEqual([expect.objectContaining({ authenticated: false })]);
  });

  it("never logs the token, the client's email or the caller's IP", async () => {
    const { token } = await signedInClient();
    const from = nextIp();

    await report(
      {
        ...crash,
        message: `Request failed for ana@example.com with Bearer ${token}`,
        stack: `Error: session ${token} of ana@example.com\n    at signIn`,
      },
      { token, from },
    );

    const [line] = log.mock.calls[0] as [string];
    expect(log).toHaveBeenCalledTimes(1);
    expect(line).not.toContain(token);
    expect(line).not.toContain(token.split(".")[1]);
    expect(line).not.toContain("ana@example.com");
    expect(line).not.toContain(from);
    expect(JSON.parse(line)).toMatchObject({
      message: "Request failed for [email] with Bearer [token]",
      stack: "Error: session [token] of [email]\n    at signIn",
    });
  });

  it("drops fields it doesn't know and ones of the wrong type", async () => {
    await report({
      message: "boom",
      fatal: "yes",
      screen: 42,
      platform: { os: "ios" },
      email: "ana@example.com",
      token: "secret",
      project: { ref: "VTH-26-001" },
      level: "info",
      event: "spoofed",
    });

    expect(Object.keys(lines()[0]!).sort()).toEqual(["authenticated", "event", "fatal", "level", "message", "time"]);
    expect(lines()[0]).toMatchObject({
      level: "error",
      event: "mobile.client_error",
      message: "boom",
      fatal: false,
      authenticated: false,
    });
  });

  it("cuts every field to its length and the stack to its first lines", async () => {
    const stack = Array.from({ length: 40 }, (_, i) => `    at frame${i}`).join("\n");

    await report({
      message: "m".repeat(900),
      stack,
      screen: "s".repeat(900),
      appVersion: "1".repeat(900),
      platform: "p".repeat(900),
      osVersion: "9".repeat(900),
      locale: "l".repeat(900),
    });

    const line = lines()[0] as Record<string, string>;
    expect(line.message).toHaveLength(500);
    expect(line.stack!.split("\n")).toHaveLength(12);
    expect(line.stack).toContain("frame11");
    expect(line.stack).not.toContain("frame12");
    expect(line.screen).toHaveLength(120);
    expect(line.appVersion).toHaveLength(40);
    expect(line.platform).toHaveLength(20);
    expect(line.osVersion).toHaveLength(40);
    expect(line.locale).toHaveLength(20);
  });

  it("keeps a long stack whole through the logger: what doesn't fit in `stack` goes on in `stack2`…", async () => {
    // Twelve frames of 150 characters: 1 811 in all, where the logger keeps 500 of a field.
    const frames = Array.from({ length: 12 }, (_, i) => `    at Frame${i} (${"x".repeat(120)}.bundle:1:${1000 + i})`.padEnd(150, "."));

    await report({ ...crash, stack: frames.join("\n") });

    const line = lines()[0] as Record<string, string>;
    const parts = Object.keys(line).filter((key) => key.startsWith("stack"));
    expect(parts).toEqual(["stack", "stack2", "stack3", "stack4"]);
    for (const part of parts) expect(line[part]!.length).toBeLessThanOrEqual(500);
    // Whole frames in each, none cut and none lost.
    expect(parts.flatMap((part) => line[part]!.split("\n"))).toEqual(frames);
    expect(line).toMatchObject({ event: "mobile.client_error", message: crash.message, screen: crash.screen, appVersion: "1.0.0" });
  });

  it("rejects an oversized body without logging it", async () => {
    const res = await report({ message: "boom", stack: "x".repeat(9000) });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "body_too_large" });
    expect(log).not.toHaveBeenCalled();
  });

  it("rejects a body that says it is oversized before reading it", async () => {
    const res = await report(crash, { headers: { "content-length": "999999" } });

    expect(res.status).toBe(413);
    expect(log).not.toHaveBeenCalled();
  });

  it.each(["{not json", "[]", '"boom"', "{}", '{"message":"   "}', '{"message":42}', ""])(
    "rejects a body that isn't a report: %s",
    async (body) => {
      const res = await report(body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_body" });
      expect(log).not.toHaveBeenCalled();
    },
  );

  it("stops logging an IP past its limit, still answering 204, until the window ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const from = nextIp();

    for (let i = 0; i < 10; i++) expect((await report(crash, { from })).status).toBe(204);
    expect(log).toHaveBeenCalledTimes(10);

    const limited = await report(crash, { from });
    expect(limited.status).toBe(204);
    expect(log).toHaveBeenCalledTimes(10);

    // Another phone is not held back by it.
    await report(crash);
    expect(log).toHaveBeenCalledTimes(11);

    vi.setSystemTime(Date.now() + 61_000);
    expect((await report(crash, { from })).status).toBe(204);
    expect(log).toHaveBeenCalledTimes(12);
  });

  it("keeps the instance's share for the phones that are within theirs: an address refused over and over uses none of it", async () => {
    // An instance of its own: its windows start empty, and what this fills stays out of the other tests.
    vi.resetModules();
    const { POST: post } = await import("./route");
    const flood = nextIp();

    // Ten get in; the four hundred after them are refused by their own address's window.
    for (let i = 0; i < 410; i++) expect((await report(crash, { from: flood, post })).status).toBe(204);
    expect(log).toHaveBeenCalledTimes(10);

    // Every other phone still reports: the instance has room for 300 in all, and only those ten used any.
    for (let i = 0; i < 290; i++) await report(crash, { from: `198.51.${i >> 8}.${i & 255}`, post });
    expect(log).toHaveBeenCalledTimes(300);

    // And the instance's own ceiling still holds, whatever the addresses.
    await report(crash, { from: "198.51.100.1", post });
    await report(crash, { from: "198.51.100.2", post });
    expect(log).toHaveBeenCalledTimes(300);
  });

  it("takes a cut field's address or token out before the cut, never leaving half of one", async () => {
    const { token } = await signedInClient();

    await report({
      ...crash,
      // The cuts (500 and 120 characters) fall inside the address and the token.
      message: `${"m".repeat(490)} ana.lopez@example.com`,
      screen: `${"s".repeat(100)} Bearer ${token}`,
    });

    const line = lines()[0] as Record<string, string>;
    expect(line.message).toBe(`${"m".repeat(490)} [email]`);
    expect(line.screen).toBe(`${"s".repeat(100)} Bearer [token]`);
    expect(JSON.stringify(line)).not.toMatch(/ana|lopez|eyJ/);
  });

  it("counts rejected bodies against the limit too", async () => {
    const from = nextIp();
    for (let i = 0; i < 10; i++) expect((await report("{not json", { from })).status).toBe(400);

    expect((await report(crash, { from })).status).toBe(204);
    expect(log).not.toHaveBeenCalled();
  });
});
