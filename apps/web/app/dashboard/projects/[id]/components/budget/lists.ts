// Edits to the budget's text lists (justification blocks, annex, exclusions),
// returning a new list to save.

export const replaceAt = <T,>(list: T[], index: number, item: T) => list.map((x, i) => (i === index ? item : x));

export const removeAt = <T,>(list: T[], index: number) => list.filter((_, i) => i !== index);

export function moveItem<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
