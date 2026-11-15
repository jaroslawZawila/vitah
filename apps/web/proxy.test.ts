import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The matcher and the page policy are under test; keep NextAuth out of it.
vi.mock("./auth", () => ({ auth: (handler: unknown) => handler }));

const { config, default: proxy } = await import("./proxy");

function matches(url: string) {
  return unstable_doesMiddlewareMatch({ config, url });
}

describe("proxy matcher", () => {
  it.each(["/dashboard", "/dashboard/projects/abc", "/api/other", "/api/health/details", "/api/healthy", "/api/csp-report/x"])("protects %s", (url) => {
    expect(matches(url)).toBe(true);
  });

  it.each([
    "/api/auth/session",
    "/api/mobile/auth",
    "/api/mobile/project",
    // The app reports its crashes signed out too (the route authenticates by itself).
    "/api/mobile/client-error",
    // The uptime check has no session.
    "/api/health",
    // Browsers send policy violations without cookies.
    "/api/csp-report",
    "/_next/static/chunk.js",
    "/favicon.ico",
    // Vercel Speed Insights: its script and beacon must work signed out, e.g. on the login page.
    "/_vercel/speed-insights/script.js",
    "/_vercel/speed-insights/vitals",
    // The Workflow SDK's queue calls its own routes (the budget's AI run).
    "/.well-known/workflow/v1/flow",
    "/.well-known/workflow/v1/step",
  ])("skips %s", (url) => {
    expect(matches(url)).toBe(false);
  });
});

/** What the proxy answers for a page: the response's policy, and the one it passes on to the render. */
function page(url = "http://localhost/dashboard/projects", headers: Record<string, string> = {}) {
  const run = proxy as unknown as (request: NextRequest) => Response;
  const response = run(new NextRequest(url, { headers }));
  return {
    response,
    policy: response.headers.get("content-security-policy-report-only")!,
    /** The request header Next's render reads the nonce from. */
    forwarded: (name: string) => response.headers.get(`x-middleware-request-${name}`),
    nonce: /'nonce-([^']+)'/.exec(response.headers.get("content-security-policy-report-only") ?? "")?.[1],
  };
}

describe("the pages' script policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is sent report-only with a nonce, and the same policy goes on to the render", () => {
    const { response, policy, forwarded, nonce } = page();

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(policy).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(forwarded("content-security-policy-report-only")).toBe(policy);
    // The enforced page rules come from next.config.js, not from here.
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("uses a new nonce for every request", () => {
    const nonces = new Set(Array.from({ length: 20 }, () => page().nonce));
    expect(nonces.size).toBe(20);
  });

  it("never allows eval in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(page().policy).not.toContain("unsafe-eval");
  });

  it("allows eval for Next's dev server in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(page().policy).toContain("'unsafe-eval'");
  });

  it("drops a policy the caller sent, so Next never takes the caller's nonce", () => {
    const { response, forwarded, nonce } = page(undefined, {
      "content-security-policy": "script-src 'nonce-attacker'",
      "content-security-policy-report-only": "script-src 'nonce-attacker2'",
    });

    // The request headers the render gets: exactly the ones listed here.
    const overridden = response.headers.get("x-middleware-override-headers")!.split(",");
    expect(overridden).not.toContain("content-security-policy");
    expect(overridden).toContain("content-security-policy-report-only");
    expect(forwarded("content-security-policy-report-only")).toContain(`'nonce-${nonce}'`);
    expect(forwarded("content-security-policy-report-only")).not.toContain("attacker");
  });

  it("keeps the request's other headers for the render", () => {
    const { forwarded } = page(undefined, { "accept-language": "en" });
    expect(forwarded("accept-language")).toBe("en");
  });
});
