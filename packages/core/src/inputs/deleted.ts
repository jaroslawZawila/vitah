import { z } from "zod";
import { isDeletedKind, type DeletedKind } from "../contract";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../paging";

// The query of Elementos eliminados' list (../deleted's listDeleted), as a URL
// carries it (strings) or a caller passes it. Each filter is left out when
// missing, null or ""; anything it can't read is `invalid_input`.

const given = (value: unknown) => value !== undefined && value !== null && value !== "";

/** `<deleted_at to the microsecond>_<id>`: where a page ended. */
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6})_([\w-]{1,64})$/;

/** A moment that exists (not the 30th of February), so the database never has to say so. */
function isMoment(at: string) {
  const time = Date.parse(`${at}Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 23) === at.slice(0, 23);
}

/** A filter read by `read`: undefined when not given; `invalid_input` when `read` gives undefined. */
const filter = <T, I = unknown>(read: (value: unknown) => T | undefined) =>
  z
    .custom<I>()
    .optional()
    .transform((value, ctx): T | undefined => {
      if (!given(value)) return undefined;
      const result = read(value);
      if (result !== undefined) return result;
      ctx.issues.push({ code: "custom", message: "invalid_input", input: value });
      return z.NEVER;
    });

/** The list's filters, a page's size and where the last page ended (`cursor`: that page's `nextCursor`). */
export const deletedListSchema = z.object({
  kind: filter<DeletedKind, DeletedKind>((value) => (isDeletedKind(value) ? value : undefined)),
  projectId: filter<string, string>((value) => (typeof value === "string" ? value : undefined)),
  // The lists' one policy for a page's size (../paging): 50 unless asked, never more than 200.
  limit: filter<number, number | string>((value) => {
    const limit = Number(value);
    return Number.isInteger(limit) && limit >= 1 ? Math.min(limit, MAX_PAGE_SIZE) : undefined;
  }).transform((limit) => limit ?? DEFAULT_PAGE_SIZE),
  cursor: filter<{ at: string; id: string }, string>((value) => {
    const cursor = CURSOR.exec(String(value));
    return cursor && isMoment(cursor[1]!) ? { at: cursor[1]!, id: cursor[2]! } : undefined;
  }),
});

// Its callers' type is ../contract's DeletedFilters.
