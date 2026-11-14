// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useListQuery, useSearchText } from "./useListQuery";

const navigation = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  usePathname: () => "/dashboard/compras",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

beforeEach(() => {
  navigation.replace.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("useListQuery", () => {
  it("changes filters in the URL, back on the first page, and links to the other pages", () => {
    navigation.search = "estado=open&q=piedra&page=4";
    const { result } = renderHook(() => useListQuery());

    act(() => result.current.set({ obra: "p-1" }));
    expect(navigation.replace).toHaveBeenLastCalledWith("/dashboard/compras?estado=open&q=piedra&obra=p-1", { scroll: false });
    // An empty value takes its parameter out.
    act(() => result.current.set({ estado: null, q: "" }));
    expect(navigation.replace).toHaveBeenLastCalledWith("/dashboard/compras", { scroll: false });

    expect(result.current.pageHref(5)).toBe("/dashboard/compras?estado=open&q=piedra&page=5");
    expect(result.current.pageHref(1)).toBe("/dashboard/compras?estado=open&q=piedra");
  });
});

describe("useSearchText", () => {
  it("searches once typing stops, not on every key", () => {
    const onSearch = vi.fn();
    const { result } = renderHook(({ value }) => useSearchText(value, onSearch), { initialProps: { value: "" } });

    act(() => result.current[1]("p"));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current[1]("pi"));
    act(() => vi.advanceTimersByTime(200));
    expect(onSearch).not.toHaveBeenCalled();
    expect(result.current[0]).toBe("pi");
    act(() => vi.advanceTimersByTime(100));
    expect(onSearch).toHaveBeenCalledExactlyOnceWith("pi");
  });

  it("keeps what is typed while the URL catches up, and takes a URL that changes on its own", () => {
    const onSearch = vi.fn();
    const { result, rerender } = renderHook(({ value }) => useSearchText(value, onSearch), { initialProps: { value: "" } });

    act(() => result.current[1]("ven"));
    act(() => vi.advanceTimersByTime(300));
    expect(onSearch).toHaveBeenLastCalledWith("ven");
    // Still typing when the page comes back searched by "ven".
    act(() => result.current[1]("venta"));
    rerender({ value: "ven" });
    expect(result.current[0]).toBe("venta");
    act(() => vi.advanceTimersByTime(300));
    expect(onSearch).toHaveBeenLastCalledWith("venta");
    rerender({ value: "venta" });
    expect(result.current[0]).toBe("venta");

    // The browser's back: the URL's text wins.
    rerender({ value: "piedra" });
    expect(result.current[0]).toBe("piedra");
    act(() => vi.advanceTimersByTime(300));
    expect(onSearch).toHaveBeenCalledTimes(2);

    // Spaces around aren't a new search.
    act(() => result.current[1](" piedra "));
    act(() => vi.advanceTimersByTime(300));
    expect(onSearch).toHaveBeenCalledTimes(2);
  });

  it("shows the URL's text after Back then Forward to what was last searched, and never searches it away", () => {
    const onSearch = vi.fn();
    const { result, rerender } = renderHook(({ value }) => useSearchText(value, onSearch), { initialProps: { value: "" } });

    // Typed and searched: the page comes back with ?q=piedra.
    act(() => result.current[1]("piedra"));
    act(() => vi.advanceTimersByTime(300));
    expect(onSearch).toHaveBeenCalledExactlyOnceWith("piedra");
    rerender({ value: "piedra" });
    expect(result.current[0]).toBe("piedra");

    // Back, to the list before the search: the box empties, and that is no search.
    rerender({ value: "" });
    expect(result.current[0]).toBe("");
    act(() => vi.advanceTimersByTime(1_000));
    expect(onSearch).toHaveBeenCalledTimes(1);

    // Forward, to the very text last searched: the box shows it again...
    rerender({ value: "piedra" });
    expect(result.current[0]).toBe("piedra");
    // ...and the filter stays: nothing is searched once typing "stops".
    act(() => vi.advanceTimersByTime(1_000));
    expect(onSearch).toHaveBeenCalledTimes(1);

    // And back and forth again, the same.
    rerender({ value: "" });
    rerender({ value: "piedra" });
    expect(result.current[0]).toBe("piedra");
    act(() => vi.advanceTimersByTime(1_000));
    expect(onSearch).toHaveBeenCalledTimes(1);

    // Typing from there searches as ever.
    act(() => result.current[1]("piedra caliza"));
    act(() => vi.advanceTimersByTime(300));
    expect(onSearch).toHaveBeenLastCalledWith("piedra caliza");
    expect(onSearch).toHaveBeenCalledTimes(2);
  });

  it("takes a URL change made before its own search arrived, then the search when it does", () => {
    const onSearch = vi.fn();
    const { result, rerender } = renderHook(({ value }) => useSearchText(value, onSearch), { initialProps: { value: "grava" } });

    act(() => result.current[1]("arena"));
    act(() => vi.advanceTimersByTime(300));
    expect(onSearch).toHaveBeenCalledExactlyOnceWith("arena");
    // Back, before the page searched by "arena" arrived: the URL's text is shown, and stays.
    rerender({ value: "" });
    expect(result.current[0]).toBe("");
    act(() => vi.advanceTimersByTime(1_000));
    // Then a link to that same text: the URL's again, not an echo of the search made before.
    rerender({ value: "arena" });
    expect(result.current[0]).toBe("arena");
    act(() => vi.advanceTimersByTime(1_000));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("keeps what is typed when two searches arrive one after the other, or only the last", () => {
    const onSearch = vi.fn();
    const { result, rerender } = renderHook(({ value }) => useSearchText(value, onSearch), { initialProps: { value: "" } });
    const type = (text: string) => {
      act(() => result.current[1](text));
      act(() => vi.advanceTimersByTime(300));
    };

    // Two searches sent before either page arrived; typing goes on.
    type("v");
    type("ve");
    act(() => result.current[1]("ven"));
    rerender({ value: "v" });
    expect(result.current[0]).toBe("ven");
    rerender({ value: "ve" });
    expect(result.current[0]).toBe("ven");
    act(() => vi.advanceTimersByTime(300));
    expect(onSearch.mock.calls).toEqual([["v"], ["ve"], ["ven"]]);
    rerender({ value: "ven" });

    // The first never shows (the second replaced it on its way): the last arriving settles both.
    type("vent");
    type("venta");
    rerender({ value: "venta" });
    expect(result.current[0]).toBe("venta");
    // So "vent" is no longer awaited: the URL going there is the URL's doing.
    act(() => result.current[1]("ventana"));
    rerender({ value: "vent" });
    expect(result.current[0]).toBe("vent");
    act(() => vi.advanceTimersByTime(1_000));
    expect(onSearch).toHaveBeenCalledTimes(5);
  });

  it("does not search a URL's text for the spaces around it", () => {
    const onSearch = vi.fn();
    const { result, rerender } = renderHook(({ value }) => useSearchText(value, onSearch), { initialProps: { value: "" } });

    rerender({ value: " piedra " });
    expect(result.current[0]).toBe(" piedra ");
    act(() => vi.advanceTimersByTime(1_000));
    expect(onSearch).not.toHaveBeenCalled();
  });
});
