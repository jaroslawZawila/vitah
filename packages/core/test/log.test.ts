import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, logError, logLine, logWarn, scrub } from "../src/log";

afterEach(() => vi.restoreAllMocks());

const NOW = new Date("2026-11-14T10:02:11.482Z");

describe("logLine", () => {
  it("is level, time, event, the fields, then the error", () => {
    const error = new TypeError("database down");
    error.stack = "TypeError: database down\n    at markChanged (/app/changes.ts:54:5)\n    at async addPhoto (/app/photos.ts:90:3)";

    const line = logLine("error", "changes.mark_failed", error, { projectId: "p1", attempt: 2, retried: false }, NOW);

    expect(line).toEqual({
      level: "error",
      time: "2026-11-14T10:02:11.482Z",
      event: "changes.mark_failed",
      projectId: "p1",
      attempt: 2,
      retried: false,
      error: {
        name: "TypeError",
        message: "database down",
        stack: ["at markChanged (/app/changes.ts:54:5)", "at async addPhoto (/app/photos.ts:90:3)"],
      },
    });
    expect(Object.keys(line).slice(0, 3)).toEqual(["level", "time", "event"]);
  });

  it("drops fields named like a secret or a person, whatever they hold", () => {
    const line = logLine(
      "error",
      "api.internal_error",
      undefined,
      {
        id: "3f9c2a1b",
        cookie: "session=abc",
        Authorization: "Bearer abc",
        password: "vitah2026",
        accessToken: "abc",
        email: "ana@vitah.es",
        userEmail: "ana@vitah.es",
        body: '{"a":1}',
        requestBody: "x",
        headers: "x",
        query: "a=1",
        searchParams: "a=1",
        clientSecret: "x",
      },
      NOW,
    );

    expect(line).toEqual({ level: "error", time: NOW.toISOString(), event: "api.internal_error", id: "3f9c2a1b" });
  });

  it("keeps a line flat: objects and lists are left out, and no field replaces level, time, event or error", () => {
    const line = logLine("warn", "x", undefined, { level: "debug", time: "never", event: "y", error: "z", nested: { cookie: "a" }, list: ["a"], when: NOW, big: 10n, none: null }, NOW);

    expect(line).toEqual({ level: "warn", time: NOW.toISOString(), event: "x", when: NOW.toISOString(), big: "10", none: null });
  });

  it("cuts query strings and e-mail addresses out of every text", () => {
    const error = new Error("No user ana.lopez@vitah.es at /api/v1/users?token=abc&email=x");
    error.stack = "Error: No user ana.lopez@vitah.es\n    at getMe (/app/node_modules/.pnpm/next@16.2.0_react@19.2.3/users.ts:1:1)";

    const line = logLine("error", "x", error, { path: "/dashboard/projects?q=ana@vitah.es", note: "see https://portal.vitah.es/api/v1/me?lang=en now" }, NOW);

    expect(line.path).toBe("/dashboard/projects");
    expect(line.note).toBe("see https://portal.vitah.es/api/v1/me now");
    expect(line.error?.message).toBe("No user [email] at /api/v1/users");
    // The stack's lines are code, not data: kept as thrown, without the message line.
    expect(line.error?.stack).toEqual(["at getMe (/app/node_modules/.pnpm/next@16.2.0_react@19.2.3/users.ts:1:1)"]);
    expect(JSON.stringify(line)).not.toMatch(/vitah\.es\?|token|ana/);
  });
});

describe("describeError", () => {
  it("keeps the first lines of the stack only", () => {
    const error = new Error("boom");
    error.stack = ["Error: boom", ...Array.from({ length: 20 }, (_, i) => `    at frame${i} (/app/file.ts:${i}:1)`)].join("\n");

    const { stack } = describeError(error);

    expect(stack).toHaveLength(6);
    expect(stack?.[0]).toBe("at frame0 (/app/file.ts:0:1)");
  });

  it("carries an error's code and its cause's message", () => {
    const error = Object.assign(new Error("insert failed", { cause: new Error("duplicate key for bea@vitah.es") }), { code: "23505" });

    expect(describeError(error)).toMatchObject({ name: "Error", message: "insert failed", code: "23505", cause: "duplicate key for [email]" });
  });

  it("keeps a failed query's statement and code, not the values it ran with", () => {
    const failed = new Error('Failed query: insert into "users" ("name", "phone") values ($1, $2)\nparams: Ana López,600123123', {
      cause: Object.assign(new Error('duplicate key value violates unique constraint "users_tenant_email"'), { code: "23505" }),
    });

    const described = describeError(failed);

    expect(described).toMatchObject({
      message: 'Failed query: insert into "users" ("name", "phone") values ($1, $2)',
      code: "23505",
      cause: 'duplicate key value violates unique constraint "users_tenant_email"',
    });
    expect(JSON.stringify(described)).not.toMatch(/Ana|600123123/);
  });

  it("describes what was thrown even when it is no Error", () => {
    expect(describeError("plain text")).toEqual({ name: "NonError", message: "plain text" });
    expect(describeError(undefined)).toEqual({ name: "NonError", message: "undefined" });
  });

  it("shortens an endless message", () => {
    expect(scrub("x".repeat(2_000))).toHaveLength(501);
  });

  it("cuts addresses of any shape, and leaves what only looks like one", () => {
    expect(scrub("from ana.lopez+obra@mail.vitah.es, bea_2@vitah.es; a@b@c.dev")).toBe("from [email], [email]; a@[email]");
    expect(scrub(`${"n".repeat(300)}@vitah.es wrote`)).toBe("[email] wrote");
    // No dot after the @, no address.
    expect(scrub("user@localhost and 3 @ 4")).toBe("user@localhost and 3 @ 4");
  });

  it("returns at once on a huge unbroken token: it is cut before anything is matched", () => {
    const tokens = [
      "a".repeat(200_000),
      "/".repeat(200_000),
      "a.".repeat(100_000),
      `${"a".repeat(100_000)}@${"b".repeat(100_000)}`,
      "a@".repeat(100_000),
      `/${"x?".repeat(100_000)}`,
    ];
    for (const token of tokens) {
      const started = performance.now();
      const clean = scrub(token);
      expect(performance.now() - started).toBeLessThan(100);
      expect(clean.length).toBeLessThanOrEqual(501);
    }
    // The same through a logged error.
    const started = performance.now();
    describeError(new Error(`No user ${"a".repeat(200_000)}`));
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("leaves no half of an address where a long text is cut", () => {
    // The cut (4000 characters) falls inside the address; the query string before it leaves room to show it.
    const text = `/api/v1/x?${"q".repeat(3_970)} sent to ana.lopez@vitah.es and more`;

    const clean = scrub(text);

    expect(clean).toBe("/api/v1/x sent to [email]…");
  });
});

describe("logError and logWarn", () => {
  it("write one JSON line to stderr", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logError("changes.mark_failed", new Error("database down"), { projectId: "p1" });
    logWarn("health.slow", undefined, { check: "db" });

    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = error.mock.calls[0]![0] as string;
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({ level: "error", event: "changes.mark_failed", projectId: "p1", error: { name: "Error", message: "database down" } });
    expect(JSON.parse(line).time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(JSON.parse(warn.mock.calls[0]![0] as string)).toEqual({ level: "warn", time: expect.any(String), event: "health.slow", check: "db" });
  });

  it("never fail their caller", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("stderr closed");
    });

    expect(() => logError("x", new Error("y"))).not.toThrow();
  });
});
