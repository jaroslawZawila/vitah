import { describe, expect, it } from "vitest";
import { nextConfig as config } from "./next.config.js";
import { ENFORCE_SCRIPT_POLICY, FILE_CSP, JSON_CSP, PAGE_CSP, PDF_CSP, fileHeaders, pagePolicy } from "./lib/security-headers.js";

type Rule = { source: string; headers: { key: string; value: string }[] };

async function rules() {
  const [pages, api, ...rest] = (await config.headers!()) as Rule[];
  expect(rest).toEqual([]);
  return { pages: pages!, api: api! };
}

const headersOf = (rule: Rule) => Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
const matches = (rule: Rule, path: string) =>
  new RegExp(`^${rule.source.replace("/:path*", "(?:/.*)?")}$`).test(path);

/** The headers next.config.js sends with a response to `path`, all rules together. */
async function headersFor(path: string) {
  const { pages, api } = await rules();
  return { ...(matches(pages, path) ? headersOf(pages) : {}), ...(matches(api, path) ? headersOf(api) : {}) };
}

/** A policy's directives, by name. */
const directives = (policy: string) =>
  Object.fromEntries(policy.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));

const EVERY_RESPONSE = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
};

describe("security headers", () => {
  it.each(["/", "/dashboard/projects/p1", "/dashboard/projects/p1/budget/pdf", "/_next/static/chunk.js"])(
    "are sent on every page and forbid framing: %s",
    async (path) => {
      const headers = await headersFor(path);

      expect(headers).toMatchObject(EVERY_RESPONSE);
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["Content-Security-Policy"]).toBe(PAGE_CSP);
      expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
      expect(config.poweredByHeader).toBe(false);
    },
  );

  it.each([
    "/api/v1/projects/p1/documents/d1",
    "/api/mobile/documents/d1",
    "/api/mobile/project",
    "/api/auth/session",
    "/api/health",
    "/api/csp-report",
  ])("send the API only what every response shares, so its files and JSON set their own policy: %s", async (path) => {
    const headers = await headersFor(path);

    expect(headers).toEqual(EVERY_RESPONSE);
    // A header set here would win over the route's (Next keeps the first one set).
    expect(headers).not.toHaveProperty("Content-Security-Policy");
    expect(headers).not.toHaveProperty("X-Frame-Options");
  });

  it("enforce the page rules alone while the script policy is report-only", () => {
    // Switching it on moves PAGE_CSP into the enforced page policy (proxy.ts).
    expect(ENFORCE_SCRIPT_POLICY).toBe(false);
    expect(PAGE_CSP).toBe("frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
  });
});

describe("the pages' script policy", () => {
  it("lets scripts run only with the request's nonce, never eval in production", () => {
    const policy = pagePolicy("abc123==");
    const d = directives(policy);

    expect(d["script-src"]).toEqual(["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
    expect(policy).not.toContain("unsafe-eval");
    expect(d["style-src-elem"]).toEqual(["'self'", "'nonce-abc123=='"]);
    expect(d["object-src"]).toEqual(["'none'"]);
  });

  it("carries the enforced page rules, so it can replace them", () => {
    const d = directives(pagePolicy("n"));
    for (const [name, sources] of Object.entries(directives(PAGE_CSP))) expect(d[name]).toEqual(sources);
  });

  it("reports to /api/csp-report, by report-uri only (Chrome would skip it for a report-to group)", () => {
    const d = directives(pagePolicy("n"));
    expect(d["report-uri"]).toEqual(["/api/csp-report"]);
    expect(d).not.toHaveProperty("report-to");
  });

  it("allows the browser's direct uploads to Vercel Blob and the portal's own PDF frame", () => {
    const d = directives(pagePolicy("n"));
    expect(d["connect-src"]).toEqual(["'self'", "https://vercel.com"]);
    expect(d["frame-src"]).toEqual(["'self'"]);
  });

  it("gives Next's dev server what it needs in development only", () => {
    const d = directives(pagePolicy("n", { dev: true }));
    expect(d["script-src"]).toContain("'unsafe-eval'");
    expect(d["style-src-elem"]).toContain("'unsafe-inline'");
  });
});

describe("the API's own policies", () => {
  it("lock JSON down: nothing loads, nothing frames it", () => {
    expect(JSON_CSP).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it("let a photo or a ZIP load nothing, framed by the portal only", () => {
    expect(directives(FILE_CSP)).toEqual({ "default-src": ["'none'"], "frame-ancestors": ["'self'"] });
    expect(fileHeaders("image/jpeg")).toEqual({ "Content-Security-Policy": FILE_CSP, "X-Frame-Options": "SAMEORIGIN", "X-Content-Type-Options": "nosniff" });
    expect(fileHeaders("application/zip")["Content-Security-Policy"]).toBe(FILE_CSP);
  });

  it("leave a PDF's viewer alone: only who may frame it", () => {
    expect(directives(PDF_CSP)).toEqual({ "frame-ancestors": ["'self'"] });
    expect(fileHeaders("application/pdf")).toEqual({ "Content-Security-Policy": PDF_CSP, "X-Frame-Options": "SAMEORIGIN", "X-Content-Type-Options": "nosniff" });
  });
});
