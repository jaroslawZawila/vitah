import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSON_CSP } from "../../../lib/security-headers.js";
import { POST } from "./route";

const log = vi.spyOn(console, "warn").mockImplementation(() => {});

// The rate limit is per IP: each test reports from its own.
let ip = 0;
const nextIp = () => `203.0.113.${++ip}`;

function send(
  body: unknown,
  { type = "application/csp-report", from = nextIp(), headers = {}, post = POST }: { type?: string; from?: string; headers?: Record<string, string>; post?: typeof POST } = {},
) {
  return post(
    new Request("http://localhost/api/csp-report", {
      method: "POST",
      headers: { "Content-Type": type, "x-real-ip": from, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/** What was written to the log: the parsed line of each call. */
const lines = () => log.mock.calls.map(([line]) => JSON.parse(line as string) as Record<string, unknown>);

const SECRET_URL = "http://localhost/dashboard/projects/p1/compras?vista=pedidos&email=ana@example.com#x";

/** As browsers send it for `report-uri`. */
const legacy = (fields: Record<string, unknown> = {}) => ({
  "csp-report": {
    "document-uri": SECRET_URL,
    referrer: "http://localhost/dashboard?token=abc",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "default-src 'self'; script-src 'self' 'nonce-c2VjcmV0' 'strict-dynamic'",
    disposition: "report",
    "blocked-uri": "https://evil.example.com/steal.js?session=eyJhbGciOiJIUzI1NiJ9.e30.sig",
    "status-code": 200,
    "script-sample": "alert(document.cookie)",
    ...fields,
  },
});

/** As the Reporting API sends it (`report-to`). */
const reporting = (body: Record<string, unknown> = {}) => ({
  type: "csp-violation",
  age: 10,
  url: SECRET_URL,
  user_agent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/142",
  body: {
    documentURL: SECRET_URL,
    referrer: "",
    blockedURL: "inline",
    effectiveDirective: "style-src-elem",
    originalPolicy: "default-src 'self'; script-src 'nonce-c2VjcmV0'",
    sourceFile: "http://localhost/_next/static/chunks/app.js?v=1",
    sample: "body{color:red}",
    disposition: "report",
    statusCode: 200,
    lineNumber: 3,
    columnNumber: 7,
    ...body,
  },
});

beforeEach(() => {
  log.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/csp-report", () => {
  it("logs a legacy report as one line: the directive, the blocked origin and the page's path", async () => {
    const res = await send(legacy());

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(lines()).toEqual([
      {
        level: "warn",
        time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
        event: "csp.violation",
        directive: "script-src-elem",
        blocked: "https://evil.example.com",
        path: "/dashboard/projects/p1/compras",
      },
    ]);
  });

  it("logs each violation of a Reporting API batch", async () => {
    const res = await send(
      [
        reporting(),
        reporting({ effectiveDirective: "script-src-elem", blockedURL: "eval", documentURL: "http://localhost/" }),
        { type: "deprecation", url: SECRET_URL, body: { id: "x", message: "y" } },
      ],
      { type: "application/reports+json" },
    );

    expect(res.status).toBe(204);
    expect(lines().map(({ directive, blocked, path }) => ({ directive, blocked, path }))).toEqual([
      { directive: "style-src-elem", blocked: "inline", path: "/dashboard/projects/p1/compras" },
      { directive: "script-src-elem", blocked: "eval", path: "/" },
    ]);
  });

  it("logs the same violation once per batch, and at most five", async () => {
    const batch = [
      ...Array.from({ length: 3 }, () => reporting()),
      ...Array.from({ length: 10 }, (_, i) => reporting({ documentURL: `http://localhost/p${i}` })),
    ];

    await send(batch, { type: "application/reports+json" });

    expect(lines().map((line) => line.path)).toEqual(["/dashboard/projects/p1/compras", "/p0", "/p1", "/p2", "/p3"]);
  });

  it.each([
    ["https://cdn.example.com/a/b.js?x=1", "https://cdn.example.com"],
    ["wss://socket.example.com/live", "wss://socket.example.com"],
    ["data", "data"],
    ["data:image/png;base64,AAAA", "data"],
    ["blob:http://localhost/1b2c", "blob"],
    ["about:srcdoc", "about"],
    ["about", "about"],
    ["filesystem:http://localhost/temporary/x", "filesystem"],
    ["chrome-extension://abcdefghijklmnop/inject.js", "extension"],
    ["moz-extension://4b1c/inject.js", "extension"],
    ["safari-web-extension://ABCD/inject.js", "extension"],
    ["inline", "inline"],
    ["eval", "eval"],
    ["wasm-eval", "wasm-eval"],
    ["trusted-types-sink", "trusted-types-sink"],
    ["", "unknown"],
    ["not a url <script>", "other"],
    ["somekeyword", "other"],
    ["javascript:alert(1)", "other"],
    ["ftp://files.example.com/x", "other"],
    ["mailto:ana@example.com", "other"],
    [`${"x".repeat(15_000)}:payload`, "other"],
    [`http://${"a".repeat(60)}.example.com/x.js`, `http://${"a".repeat(60)}.example.com`],
    [`https://${"a".repeat(63)}.${"b".repeat(63)}.example.com/x.js`, "unknown"],
    [`https://${Array.from({ length: 50 }, () => "a".repeat(60)).join(".")}.com/x.js`, "unknown"],
  ])("reduces what was blocked to a short origin, a known scheme or keyword: %s", async (blocked, expected) => {
    await send(legacy({ "blocked-uri": blocked }));
    expect(lines()[0]!.blocked).toBe(expected);
  });

  it("takes the directive's name only, also from Firefox's directive with its sources", async () => {
    await send(legacy({ "effective-directive": undefined, "violated-directive": "script-src 'self' 'nonce-c2VjcmV0'" }));
    await send(legacy({ "effective-directive": "Frame-Ancestors" }));

    expect(lines().map((line) => line.directive)).toEqual(["script-src", "frame-ancestors"]);
  });

  it.each([
    ["<img src=x>", "other"],
    ["made-up-directive", "other"],
    ["x".repeat(15_000), "other"],
    ["", "unknown"],
  ])("logs a directive it doesn't know as other: %s", async (directive, expected) => {
    await send(legacy({ "effective-directive": undefined, "violated-directive": directive }));
    expect(lines()[0]!.directive).toBe(expected);
  });

  it("never logs the rest of the report: query, policy, sample, referrer, source file", async () => {
    await send(legacy());
    await send([reporting()], { type: "application/reports+json" });

    expect(log).toHaveBeenCalledTimes(2);
    for (const [line] of log.mock.calls as [string][]) {
      expect(Object.keys(JSON.parse(line)).sort()).toEqual(["blocked", "directive", "event", "level", "path", "time"]);
      for (const secret of ["vista", "ana@example.com", "token", "session", "eyJ", "nonce", "c2VjcmV0", "alert", "cookie", "color", "steal", "Chrome", "chunks"]) {
        expect(line).not.toContain(secret);
      }
    }
  });

  it("leaves the path out when the page's URL can't be read", async () => {
    await send(legacy({ "document-uri": "about:blank" }));
    await send(legacy({ "document-uri": 42 }));

    expect(lines()).toHaveLength(2);
    for (const line of lines()) expect(line).not.toHaveProperty("path");
  });

  it("cuts a long path", async () => {
    await send(legacy({ "document-uri": `http://localhost/${"a".repeat(5000)}` }));
    expect((lines()[0]!.path as string).length).toBeLessThanOrEqual(200);
  });

  it.each(["{not json", "[]", "{}", '"x"', "null", '{"csp-report":"x"}', '[{"type":"csp-violation"}]', ""])(
    "answers 204 and logs nothing for a body that isn't a report: %s",
    async (body) => {
      const res = await send(body);
      expect(res.status).toBe(204);
      expect(log).not.toHaveBeenCalled();
    },
  );

  it("answers 204 without reading or logging an oversized body", async () => {
    const res = await send(legacy({ "script-sample": "x".repeat(20_000) }));

    expect(res.status).toBe(204);
    expect(log).not.toHaveBeenCalled();
  });

  it("answers 204 without reading a body that says it is oversized", async () => {
    const res = await send(legacy(), { headers: { "content-length": "999999" } });

    expect(res.status).toBe(204);
    expect(log).not.toHaveBeenCalled();
  });

  it("answers with the API's locked-down policy", async () => {
    const res = await send(legacy());
    expect(res.headers.get("content-security-policy")).toBe(JSON_CSP);
  });

  it("stops logging an IP past its limit, still answering 204, until the window ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const from = nextIp();

    for (let i = 0; i < 20; i++) expect((await send(legacy(), { from })).status).toBe(204);
    expect(log).toHaveBeenCalledTimes(20);

    expect((await send(legacy(), { from })).status).toBe(204);
    expect(log).toHaveBeenCalledTimes(20);

    // Another browser is not held back by it.
    await send(legacy());
    expect(log).toHaveBeenCalledTimes(21);

    vi.setSystemTime(Date.now() + 61_000);
    await send(legacy(), { from });
    expect(log).toHaveBeenCalledTimes(22);
  });

  it("keeps the instance's cap when the addresses' table fills up and is forgotten", async () => {
    vi.resetModules();
    const { POST: post } = await import("./route");

    // More fresh addresses than the table holds (5000): it is cleared, the cap is not.
    for (let i = 0; i < 5_200; i++) await send(legacy(), { from: `2001:db8::${i.toString(16)}`, post });

    expect(log).toHaveBeenCalledTimes(300);
  }, 60_000);

  it("caps what one instance logs a minute, whatever the addresses", async () => {
    vi.resetModules();
    const { POST: post } = await import("./route");

    for (let i = 0; i < 310; i++) await send(legacy(), { from: `198.51.${i >> 8}.${i & 255}`, post });

    expect(log).toHaveBeenCalledTimes(300);
  });
});
