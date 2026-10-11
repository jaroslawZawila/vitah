/**
 * Shared layout classes for step components. Steps render each field as a `Field`
 * with `Label` / `Input` from `@/components/ui`; choice cards keep a native
 * radio/checkbox as the label's first child.
 */
export const fieldStyles = {
  fields: "grid gap-3 md:grid-cols-2",
  wide: "md:col-span-2",
  intro: "text-[13px] text-muted-foreground",
  /** A list of radio/checkbox cards (e.g. pick a client, a style, a finish). */
  choices:
    "m-0 flex min-w-0 flex-col gap-2 border-0 p-0 [&>legend]:mb-1 [&>legend]:p-0",
  choice:
    "flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] border bg-card px-3.5 py-3 transition-colors hover:border-primary has-checked:border-primary has-checked:bg-brand-soft [&>input]:m-0 [&>input]:size-[18px] [&>input]:flex-none [&>input]:accent-primary",
  choiceText:
    "flex min-w-0 flex-col gap-0.5 text-sm wrap-anywhere text-foreground",
  choiceHint: "text-xs text-muted-foreground",
};
