import { invalid } from "./errors";

// Input parsing shared by the services: API bodies and form values arrive as
// unknown / strings.

/** The usual cap for a name, email, title or address. */
export const MAX_TEXT = 200;

/** Trimmed text, or undefined when missing or empty. Longer than `max` is `too_long`. */
export function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalid("too_long");
  return trimmed === "" ? undefined : trimmed;
}

/** Trimmed text cut at `max` characters ("" when missing): for free-form labels. */
export function clippedText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
