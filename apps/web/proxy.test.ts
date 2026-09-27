import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";

// Only the matcher is under test; keep NextAuth out of it.
vi.mock("./auth", () => ({ auth: (handler: unknown) => handler }));

const { config } = await import("./proxy");

function matches(url: string) {
  return unstable_doesMiddlewareMatch({ config, url });
}

describe("proxy matcher", () => {
  it.each(["/dashboard", "/dashboard/projects/abc", "/api/other"])("protects %s", (url) => {
    expect(matches(url)).toBe(true);
  });

  it.each([
    "/api/auth/session",
    "/api/mobile/auth",
    "/api/mobile/project",
    "/_next/static/chunk.js",
    "/favicon.ico",
    // Vercel Speed Insights: its script and beacon must work signed out, e.g. on the login page.
    "/_vercel/speed-insights/script.js",
    "/_vercel/speed-insights/vitals",
  ])("skips %s", (url) => {
    expect(matches(url)).toBe(false);
  });
});
