// A table reflowed into cards below `md`: its heading row is hidden there, so each figure carries its column's name.

/** A cell's column name, shown with its value on a phone and hidden from `md` up (where the heading row says it). */
export const phoneLabel = "font-sans text-meta font-normal text-muted-foreground md:hidden";

/** A cell as one line of a card: its name (`phoneLabel`) on the left, its value or input on the right. */
export const phoneLine = "max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:p-0";

/** Rows as cards of labelled figures, two to a line: `block` on the table and its body, `row`, `cell`, `label`. */
export const phoneFigures = {
  block: "max-md:block",
  row: "max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-2 max-md:px-[18px] max-md:py-3",
  cell: "max-md:flex max-md:flex-col max-md:items-start max-md:p-0 max-md:text-left",
  label: phoneLabel,
};
