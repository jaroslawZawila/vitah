// The budget's "Gastos no incluidos": the tenant's library of standard lines
// (../budget-exclusions.ts) and how a budget's own list relates to it. Pure,
// shared with the portal's checklist.

/** Lines in a tenant's library at most. */
export const MAX_EXCLUSION_PRESETS = 50;
/** Characters in one line, the library's or a budget's. */
export const MAX_EXCLUSION_TEXT = 2_000;

/** One line of the tenant's library (GET /api/v1/budgets/exclusions). */
export type ExclusionPreset = {
  id: string;
  label: string;
};

/**
 * `exclusions` (a budget's lines, as the PDF prints them) as the checklist
 * shows them: every library line, ticked or not, then the budget's own lines
 * (written for it, or a library line edited since). A line is the library's
 * when its text is the same.
 */
export function exclusionChecklist(exclusions: readonly string[], library: readonly ExclusionPreset[]) {
  const included = new Set(exclusions);
  const labels = new Set(library.map((preset) => preset.label));
  return {
    library: library.map((preset) => ({ preset, included: included.has(preset.label) })),
    extra: exclusions.filter((line) => !labels.has(line)),
  };
}

/**
 * A budget's lines with `text` ticked (`included`) or not. A library line goes
 * right after the last ticked line that comes before it in the library, else
 * before the first that comes after it, else before the budget's own lines:
 * the ticked library lines keep the library's order. Any other line goes
 * last. The other lines never move. With `replaces` (a line the budget has,
 * edited or renamed), `text` takes its place instead.
 */
export function withExclusion(
  exclusions: readonly string[],
  text: string,
  included: boolean,
  library: readonly string[],
  replaces?: string,
): string[] {
  if (included && replaces !== undefined && exclusions.includes(replaces)) {
    // In its place, once.
    const edited = exclusions.map((line) => (line === replaces ? text : line));
    return edited.filter((line, i) => line !== text || edited.indexOf(text) === i);
  }
  const rest = exclusions.filter((line) => line !== text);
  if (!included) return rest;
  const place = library.indexOf(text);
  if (place < 0) return [...rest, text];
  const order = rest.map((line) => library.indexOf(line));
  let after = -1;
  order.forEach((other, i) => {
    if (other >= 0 && other < place) after = i + 1;
  });
  const at = after >= 0 ? after : [order.findIndex((other) => other > place), order.findIndex((other) => other < 0)].find((i) => i >= 0);
  return at === undefined ? [...rest, text] : [...rest.slice(0, at), text, ...rest.slice(at)];
}
