import { describe, expect, it } from "vitest";
import config from "./next.config.js";

describe("security headers", () => {
  it("are sent on every page and forbid framing", async () => {
    const rules = await config.headers!();
    const [rule] = rules;
    expect(rules).toHaveLength(1);
    const headers = Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]));

    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(config.poweredByHeader).toBe(false);
  });

  it("leave /api alone, so its PDFs open in the browser's viewer", async () => {
    const [rule] = await config.headers!();
    const matches = (path: string) => new RegExp(`^${rule!.source}$`).test(path);

    expect(matches("/")).toBe(true);
    expect(matches("/dashboard/projects/p1")).toBe(true);
    expect(matches("/api/v1/projects/p1/documents/d1")).toBe(false);
    expect(matches("/api/mobile/documents/d1")).toBe(false);
  });
});
