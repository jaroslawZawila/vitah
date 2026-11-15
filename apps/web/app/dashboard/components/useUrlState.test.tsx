// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextOpen, openParam, openSet, parseOpen, toggleOpen, useUrlState } from "./useUrlState";

// The app router's search params follow history.replaceState; jsdom's location stands in for them.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

const goTo = (url: string) => window.history.replaceState(null, "", url);
afterEach(() => goTo("/"));

describe("the chapters open in the URL", () => {
  it("reads and writes ?abierto: absent is the default, empty is none", () => {
    expect(parseOpen(null)).toBeNull();
    expect(parseOpen("")).toEqual([]);
    expect(parseOpen("03,07,")).toEqual(["03", "07"]);
    expect(openParam(null)).toBeNull();
    expect(openParam([])).toBe("");
    expect(openParam(["03", "07"])).toBe("03,07");
    expect([...openSet(null, ["01"])]).toEqual(["01"]);
    expect([...openSet([], ["01"])]).toEqual([]);
  });

  it("toggles one chapter in the page's order, back to the default when it matches", () => {
    const order = ["01", "02", "03"];
    expect(toggleOpen(null, "03", order, [])).toEqual(["03"]);
    expect(toggleOpen(["03"], "01", order, [])).toEqual(["01", "03"]);
    expect(toggleOpen(["03"], "03", order, [])).toBeNull();
    // A filter opened 01 and 02: closing one says so, opening it again is the default.
    expect(toggleOpen(null, "02", order, ["01", "02"])).toEqual(["01"]);
    expect(toggleOpen(["01"], "02", order, ["01", "02"])).toBeNull();
    expect(nextOpen(new Set(), order, ["01"])).toEqual([]);
    expect(nextOpen(new Set(order), order, order)).toBeNull();
  });
});

describe("useUrlState", () => {
  const parse = (params: URLSearchParams) => ({ q: params.get("q") ?? "" });
  const toParams = (state: { q: string }) => ({ q: state.q || null });

  it("starts from the URL and replaces only its own parameters", () => {
    goTo("/dashboard/x?vista=pedidos&q=teja");
    const { result } = renderHook(() => useUrlState(parse, toParams));
    expect(result.current[0]).toEqual({ q: "teja" });

    const length = window.history.length;
    act(() => result.current[1]({ q: "panel" }));
    expect(result.current[0]).toEqual({ q: "panel" });
    expect(window.location.pathname + window.location.search).toBe("/dashboard/x?vista=pedidos&q=panel");
    expect(window.history.length).toBe(length);

    act(() => result.current[1]({ q: "" }));
    expect(window.location.search).toBe("?vista=pedidos");
  });

  it("follows a navigation to other parameters", () => {
    goTo("/dashboard/x?q=teja");
    const { result, rerender } = renderHook(() => useUrlState(parse, toParams));
    goTo("/dashboard/x?q=panel");
    rerender();
    expect(result.current[0]).toEqual({ q: "panel" });
  });
});
