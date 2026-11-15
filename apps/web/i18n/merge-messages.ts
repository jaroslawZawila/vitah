export type Messages = Record<string, unknown>;

const isGroup = (value: unknown): value is Messages => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `base` with `extra` laid over it, deeply (`construction.tabs` above, the rest of `construction`
 * below make one `construction`). Neither is changed: only the groups both have are copied.
 */
export function mergeMessages(base: Messages, extra: Messages): Messages {
  const merged: Messages = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const under = merged[key];
    merged[key] = isGroup(under) && isGroup(value) ? mergeMessages(under, value) : value;
  }
  return merged;
}
