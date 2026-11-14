import { describe, expect, it } from "vitest";
import { asksForPage, choiceParam, dayParam, lastPageUrl, pageParam, param, queryOf } from "./list-query";

describe("a page's list query", () => {
  it("reads a parameter's first value, trimmed", () => {
    expect(param({ q: "  piedra " }, "q")).toBe("piedra");
    expect(param({ q: ["a", "b"] }, "q")).toBe("a");
    expect(param({}, "q")).toBe("");
  });

  it("takes anything that isn't a page as the first page", () => {
    expect(pageParam({ page: "7" })).toBe(7);
    for (const page of ["0", "-1", "1.5", "abc", "", "1e3", "12345678", " 3x"]) expect(pageParam({ page })).toBe(1);
    expect(pageParam({})).toBe(1);
  });

  it("takes an unknown choice as the first one, and a day that doesn't exist as none", () => {
    const groups = ["all", "open"] as const;
    expect(choiceParam({ estado: "open" }, "estado", groups)).toBe("open");
    expect(choiceParam({ estado: "x" }, "estado", groups)).toBe("all");
    expect(choiceParam({}, "estado", groups)).toBe("all");
    expect(dayParam({ desde: "2026-10-01" }, "desde")).toBe("2026-10-01");
    for (const desde of ["2026-02-31", "2026-13-01", "01/10/2026", "ayer", ""]) expect(dayParam({ desde }, "desde")).toBe("");
  });
});

describe("a page past the end", () => {
  const paging = (page: number, pages: number) => ({ page, limit: 50, total: pages * 50, pages });

  it("goes back to the last page there is, with the same filters", () => {
    expect(lastPageUrl("/dashboard/compras", { estado: "open", q: "piedra", page: "9" }, paging(9, 3))).toBe("/dashboard/compras?estado=open&q=piedra&page=3");
    // The first page needs no parameter.
    expect(lastPageUrl("/dashboard/compras/pagos", { page: "2" }, paging(2, 1))).toBe("/dashboard/compras/pagos");
    expect(lastPageUrl("/dashboard/compras", { obra: ["p-1", "p-2"], page: "5" }, paging(5, 2))).toBe("/dashboard/compras?obra=p-1&page=2");
  });

  it("leaves a page that exists where it is", () => {
    expect(lastPageUrl("/dashboard/compras", { page: "3" }, paging(3, 3))).toBeNull();
    expect(lastPageUrl("/dashboard/compras", {}, paging(1, 1))).toBeNull();
  });
});

describe("an API route's list query", () => {
  it("passes the query string on, and knows when a page is asked for", () => {
    const query = queryOf(new Request("http://localhost/api/v1/purchases?page=2&limit=10&q=piedra&q=otra"));
    expect(query).toEqual({ page: "2", limit: "10", q: "otra" });
    expect(asksForPage(query)).toBe(true);
    expect(asksForPage(queryOf(new Request("http://localhost/api/v1/x?limit=10")))).toBe(true);
    expect(asksForPage(queryOf(new Request("http://localhost/api/v1/x?projectId=p")))).toBe(false);
    expect(asksForPage(queryOf(new Request("http://localhost/api/v1/x")))).toBe(false);
  });
});
