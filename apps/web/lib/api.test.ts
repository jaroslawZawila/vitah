import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/auth/context", () => ({ getRequestContext: vi.fn() }));
const { getRequestContext } = await import("@repo/auth/context");
const { isCrossSiteWrite, withContext } = await import("./api");

function request(method: string, headers: Record<string, string>) {
  return new Request("http://portal.vitah.es/api/v1/users", {
    method,
    headers: { host: "portal.vitah.es", ...headers },
  });
}

describe("isCrossSiteWrite", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("refuses a %s from another origin", (method) => {
    expect(isCrossSiteWrite(request(method, { origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSiteWrite(request(method, { origin: "https://shop.vitah.es" }))).toBe(true);
    expect(isCrossSiteWrite(request(method, { origin: "null" }))).toBe(true);
  });

  it("allows the portal's own origin, reads, Bearer calls and non-browser clients", () => {
    expect(isCrossSiteWrite(request("POST", { origin: "https://portal.vitah.es" }))).toBe(false);
    expect(isCrossSiteWrite(request("GET", { origin: "https://evil.example" }))).toBe(false);
    expect(
      isCrossSiteWrite(
        request("POST", { origin: "https://evil.example", authorization: "Bearer x" }),
      ),
    ).toBe(false);
    expect(isCrossSiteWrite(request("POST", {}))).toBe(false);
  });

  it("checks cookie calls that carry some other Authorization header", () => {
    expect(
      isCrossSiteWrite(
        request("POST", { origin: "https://evil.example", authorization: "Basic abc" }),
      ),
    ).toBe(true);
  });

  it("compares with the forwarded host behind a proxy", () => {
    expect(
      isCrossSiteWrite(
        request("POST", {
          host: "internal:3000",
          "x-forwarded-host": "portal.vitah.es",
          origin: "https://portal.vitah.es",
        }),
      ),
    ).toBe(false);
  });
});

describe("withContext", () => {
  it("answers 403 to a cross-site write without running the handler", async () => {
    const handler = vi.fn();

    const res = await withContext(request("POST", { origin: "https://evil.example" }), handler);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getRequestContext).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
