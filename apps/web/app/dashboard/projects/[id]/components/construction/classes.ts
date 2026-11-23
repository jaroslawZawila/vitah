// Tailwind class strings shared by the Obra tab's views.
import { touchLink } from "../../../../components/touch";

/** "Ver hitos →": a card's link to the page with the detail. */
export const moreLink =
  "inline-flex min-h-11 items-center text-sm font-semibold text-brand-ink transition-colors hover:text-primary md:min-h-0 md:pointer-coarse:min-h-11";

/** A chapter's name linking to its page, in a table row. */
export const chapterLink = `font-semibold transition-colors hover:text-primary ${touchLink}`;

/** A card's heading row: title on the left, a link or action on the right. */
export const cardTop = "flex flex-wrap items-center justify-between gap-x-4 gap-y-2";

/** A label–value row in a card, ruled above (not the first). */
export const kv = "flex items-baseline justify-between gap-3 border-t py-[7px] text-sm first:border-t-0";

/** A table's total row: a heavy rule over it. */
export const totalRow = "border-t-2 border-t-foreground font-bold hover:bg-transparent";

/** A small label beside a select or input in a filter bar. */
export const filterBox =
  "inline-flex min-h-[40px] items-center gap-2 rounded-[10px] border bg-card px-3 text-sm pointer-coarse:min-h-11";

/** A footnote under a card or page. */
export const footnote = "text-meta text-muted-foreground";
