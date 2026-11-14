import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "../instrumentation";
import { newErrorId } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("onRequestError (instrumentation.ts)", () => {
  it("logs one JSON line per unhandled server error: digest, method, path, route and the error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new TypeError("Cannot read properties of undefined (reading 'ref')"), { digest: "2948571036" });
    error.stack = `TypeError: Cannot read properties of undefined (reading 'ref')\n    at ProjectHeader (/app/ProjectHeader.tsx:12:20)\n    at renderWithHooks (/app/react.js:1:1)`;

    void onRequestError(
      error,
      {
        path: "/dashboard/projects/p1/compras?vista=pedidos&q=ana@vitah.es",
        method: "GET",
        headers: { cookie: "authjs.session-token=SECRET", authorization: "Bearer SECRET", "user-agent": "Firefox" },
      },
      {
        routerKind: "App Router",
        routePath: "/dashboard/projects/[id]/compras",
        routeType: "render",
        renderSource: "react-server-components",
        revalidateReason: undefined,
      },
    );

    expect(log).toHaveBeenCalledTimes(1);
    const text = log.mock.calls[0]![0] as string;
    expect(text).not.toContain("\n");
    expect(JSON.parse(text)).toEqual({
      level: "error",
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      event: "request.error",
      digest: "2948571036",
      method: "GET",
      path: "/dashboard/projects/p1/compras",
      routeType: "render",
      routePath: "/dashboard/projects/[id]/compras",
      router: "App Router",
      error: {
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'ref')",
        stack: ["at ProjectHeader (/app/ProjectHeader.tsx:12:20)", "at renderWithHooks (/app/react.js:1:1)"],
      },
    });
    // No cookie, authorization header, query string or e-mail address.
    expect(text).not.toMatch(/SECRET|cookie|authorization|vista|ana@|Firefox/i);
  });

  it("logs a server action's and a route handler's errors the same way", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    void onRequestError(
      new Error("boom"),
      { path: "/api/v1/projects", method: "POST", headers: {} },
      { routerKind: "App Router", routePath: "/api/v1/projects", routeType: "route", revalidateReason: undefined },
    );

    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ event: "request.error", method: "POST", path: "/api/v1/projects", routeType: "route" });
  });
});

describe("newErrorId", () => {
  it("is short enough to read out, and different each time", () => {
    const ids = new Set(Array.from({ length: 50 }, newErrorId));

    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}$/);
  });
});
