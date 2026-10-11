import type { CSSProperties } from "react";

// Tailwind class strings shared by the obra, budget and payments views.

/** A card's heading row: title on the left, a summary or action on the right. */
export const cardHead = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1";

/** Small muted text: summaries, hints, secondary cells. */
export const muted = "text-[12.5px] text-muted-foreground";

/** A chapter or hito code on dark ink. */
export const codeChip =
  "w-fit min-w-[34px] justify-self-start rounded-[7px] bg-foreground px-1.5 py-0.5 text-center font-mono text-[12.5px] font-semibold text-background";

/** A row of a hito's checklist (its chapters and checks), and the label inside it. */
export const checkRow = "flex min-h-11 items-center gap-2.5 border-b text-[13.5px] last:border-b-0";
export const checkLabel = "flex min-h-11 min-w-0 flex-1 items-center gap-2.5";

/** A filter chip in a row of them (pass `aria-pressed`). */
export const chip =
  "min-h-8 rounded-full border bg-card px-3 text-[13px] font-semibold text-muted-foreground pointer-coarse:min-h-11 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background";

/** A link in running text. */
export const textLink = "font-medium text-info hover:underline";

/** The grid columns of an obra table from 768px (rows stack on phones). */
export const columns = (template: string) => ({ "--columns": template }) as CSSProperties;

/** `div role="table"` grid tables: stacked rows on phones, a grid from 768px. */
export const table = {
  root: "flex flex-col overflow-x-auto text-[13.5px]",
  head: "hidden border-b px-2 py-[7px] text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap text-muted-foreground uppercase md:grid md:min-w-fit md:grid-cols-(--columns) md:items-center md:gap-3",
  row: "flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2.5 transition-colors last:border-b-0 md:grid md:min-h-11 md:min-w-fit md:grid-cols-(--columns) md:gap-3 md:px-2 md:py-1.5 md:hover:bg-raise",
  total:
    "-mt-px flex flex-wrap items-center gap-x-3 gap-y-1 border-t-[1.5px] border-t-foreground py-2.5 font-semibold md:grid md:min-w-fit md:grid-cols-(--columns) md:gap-3 md:px-2",
  /** The row's name: a full line on phones. */
  name: "basis-full leading-snug font-medium md:basis-auto",
  nameLink: "transition-colors hover:text-primary hover:underline",
  right: "md:text-right",
  progress: "flex flex-[1_1_160px] items-center gap-2.5",
};

/** A percentage input with the % sign inside. */
export const pctInput = {
  root: "relative w-[84px] flex-none",
  input: "pr-6 text-right font-mono",
  sign: "pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[13px] text-muted-foreground",
};
