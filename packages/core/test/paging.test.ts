import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, MAX_ALL_ROWS, MAX_PAGE_SIZE, MAX_UNPAGED, allPages, filterText, pageWindow, pagingOf, searchPattern, type Paging } from "../src/paging";

describe("pageWindow", () => {
  it("is the whole list (up to MAX_UNPAGED) when no page is asked for", () => {
    expect(pageWindow()).toEqual({ page: 1, limit: MAX_UNPAGED, offset: 0, unpaged: true });
    expect(pageWindow({ page: "", limit: null })).toEqual({ page: 1, limit: MAX_UNPAGED, offset: 0, unpaged: true });
  });

  it("takes the page and limit as numbers or as a URL's strings", () => {
    expect(pageWindow({ page: 3 })).toEqual({ page: 3, limit: DEFAULT_PAGE_SIZE, offset: 2 * DEFAULT_PAGE_SIZE });
    expect(pageWindow({ page: "2", limit: "20" })).toEqual({ page: 2, limit: 20, offset: 20 });
    // A limit alone pages too: its first page.
    expect(pageWindow({ limit: 10 })).toEqual({ page: 1, limit: 10, offset: 0 });
  });

  it("cuts a limit that is too large instead of refusing it", () => {
    expect(pageWindow({ page: 2, limit: 100_000 })).toEqual({ page: 2, limit: MAX_PAGE_SIZE, offset: MAX_PAGE_SIZE });
    expect(pageWindow({ limit: "999999999" }).limit).toBe(MAX_PAGE_SIZE);
  });

  it("refuses a page or limit that isn't a whole number from 1", () => {
    for (const bad of [0, -1, 1.5, "0", "-3", "abc", "1e3", "2;drop", "12345678901", {}, [], true, NaN]) {
      expect(() => pageWindow({ page: bad }), `page ${String(bad)}`).toThrow(expect.objectContaining({ code: "invalid_page", status: 400 }));
      expect(() => pageWindow({ limit: bad }), `limit ${String(bad)}`).toThrow(expect.objectContaining({ code: "invalid_page", status: 400 }));
    }
  });
});

describe("pagingOf", () => {
  it("says how many pages there are, one at least", () => {
    expect(pagingOf(pageWindow({ page: 1, limit: 50 }), 0)).toEqual({ page: 1, limit: 50, total: 0, pages: 1 });
    expect(pagingOf(pageWindow({ page: 2, limit: 50 }), 100)).toEqual({ page: 2, limit: 50, total: 100, pages: 2 });
    expect(pagingOf(pageWindow({ page: 1, limit: 50 }), 101).pages).toBe(3);
    // A page past the end keeps its number: the caller sees it has gone too far.
    expect(pagingOf(pageWindow({ page: 9, limit: 50 }), 101)).toEqual({ page: 9, limit: 50, total: 101, pages: 3 });
  });
});

describe("pagingOf, for a list asked for whole", () => {
  it("says nothing more while the whole list fits the cap", () => {
    expect(pagingOf(pageWindow(), 0)).toEqual({ page: 1, limit: MAX_UNPAGED, total: 0, pages: 1 });
    expect(pagingOf(pageWindow(), MAX_UNPAGED)).toEqual({ page: 1, limit: MAX_UNPAGED, total: MAX_UNPAGED, pages: 1 });
  });

  it("says it was cut, and how many there are, once the cap cut it", () => {
    expect(pagingOf(pageWindow(), MAX_UNPAGED + 1)).toEqual({ page: 1, limit: MAX_UNPAGED, total: MAX_UNPAGED + 1, pages: 2, truncated: true });
    expect(pagingOf(pageWindow({ page: "", limit: "" }), 12_345)).toMatchObject({ total: 12_345, truncated: true });
  });

  it("never says so of a page that was asked for: a page is a part by design", () => {
    expect(pagingOf(pageWindow({ page: 1 }), 12_345)).toEqual({ page: 1, limit: DEFAULT_PAGE_SIZE, total: 12_345, pages: 247 });
    expect(pagingOf(pageWindow({ limit: MAX_PAGE_SIZE }), 12_345)).not.toHaveProperty("truncated");
  });
});

describe("allPages", () => {
  /** A list of `total` numbered rows, read as the paged lists answer; `asked` keeps what was asked for. */
  function list(total: number) {
    const asked: { page: number; limit: number }[] = [];
    const load = async (query: { page: number; limit: number }) => {
      asked.push(query);
      const window = pageWindow(query);
      const rows = Array.from({ length: Math.max(0, Math.min(window.limit, total - window.offset)) }, (_, i) => ({ id: window.offset + i + 1 }));
      return { rows, paging: pagingOf(window, total) };
    };
    return { asked, load };
  }

  it("reads every page in turn, the largest pages there are, and returns every row once", async () => {
    const { asked, load } = list(MAX_UNPAGED + 1);

    const rows = await allPages(load);

    // One more than a whole list asked for without a page would ever return.
    expect(rows).toHaveLength(MAX_UNPAGED + 1);
    expect(rows[0]).toEqual({ id: 1 });
    expect(rows.at(-1)).toEqual({ id: MAX_UNPAGED + 1 });
    expect(new Set(rows.map((row) => row.id)).size).toBe(MAX_UNPAGED + 1);
    expect(asked).toHaveLength(Math.ceil((MAX_UNPAGED + 1) / MAX_PAGE_SIZE));
    expect(asked[0]).toEqual({ page: 1, limit: MAX_PAGE_SIZE });
    expect(asked.at(-1)).toEqual({ page: asked.length, limit: MAX_PAGE_SIZE });
  });

  it("asks once for a list of one page, or of none", async () => {
    for (const total of [0, 1, MAX_PAGE_SIZE]) {
      const { asked, load } = list(total);
      expect(await allPages(load)).toHaveLength(total);
      expect(asked).toEqual([{ page: 1, limit: MAX_PAGE_SIZE }]);
    }
  });

  it("keeps once a row that comes twice because the list grew while it was read", async () => {
    // Newest first: a row added after the first page pushes that page's last row onto the second.
    const before = [5, 4, 3, 2, 1];
    const after = [6, ...before];
    const paging = (page: number, total: number): Paging => ({ page, limit: 3, total, pages: 2 });
    const load = async ({ page }: { page: number }) =>
      page === 1 ? { rows: before.slice(0, 3).map((id) => ({ id })), paging: paging(1, 5) } : { rows: after.slice(3).map((id) => ({ id })), paging: paging(2, 6) };

    expect((await allPages(load, { key: (row) => row.id })).map((row) => row.id)).toEqual([5, 4, 3, 2, 1]);
    // Without a key every row read is kept, the repeated one too.
    expect((await allPages(load)).map((row) => row.id)).toEqual([5, 4, 3, 3, 2, 1]);
  });

  it("stops when a page comes back empty, whatever the count said", async () => {
    const load = async ({ page }: { page: number }) => ({ rows: page === 1 ? [{ id: 1 }] : [], paging: { page, limit: 1, total: 9, pages: 9 } });

    expect(await allPages(load)).toEqual([{ id: 1 }]);
  });

  it("fails, loudly, on a list past its ceiling instead of returning a part of it", async () => {
    const { asked, load } = list(MAX_ALL_ROWS + 1);

    const failed = await allPages(load).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(Error);
    // Not an expected failure the caller's adapter would turn into an empty answer.
    expect(failed).not.toHaveProperty("code");
    expect((failed as Error).message).toContain(String(MAX_ALL_ROWS + 1));
    // Found out on the first page: nothing more is read.
    expect(asked).toHaveLength(1);
    expect(MAX_ALL_ROWS).toBe(200_000);

    const small = list(11);
    await expect(allPages(small.load, { ceiling: 10 })).rejects.toThrow(/11 rows/);
    await expect(allPages(list(10).load, { ceiling: 10 })).resolves.toHaveLength(10);
  });
});

describe("filterText", () => {
  it("is the value's text, or nothing", () => {
    expect(filterText("p-1")).toBe("p-1");
    for (const none of ["", undefined, null, 7, ["p-1"], {}]) expect(filterText(none)).toBeNull();
  });
});

describe("searchPattern", () => {
  it("wraps the text for ilike, its wildcards taken literally", () => {
    expect(searchPattern("  piedra ")).toBe("%piedra%");
    expect(searchPattern("100%_\\")).toBe("%100\\%\\_\\\\%");
    expect(searchPattern("")).toBeNull();
    expect(searchPattern("   ")).toBeNull();
    expect(searchPattern(undefined)).toBeNull();
    expect(searchPattern(7)).toBeNull();
    expect(searchPattern("x".repeat(500))).toHaveLength(102);
  });
});
