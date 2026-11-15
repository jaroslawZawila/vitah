// Guards the portal theme's colour contrast (WCAG 2.x AA): every text colour token on the backgrounds
// it is used on reaches 4.5:1 in the light and the dark theme, as defined in globals.css.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** The `--name: #rrggbb` declarations of the first block whose header matches. */
function tokens(header: RegExp): Record<string, string> {
  const start = css.search(header);
  if (start < 0) throw new Error(`no block ${header}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

const light = tokens(/^:root \{/m);
const darkMedia = tokens(/@media \(prefers-color-scheme: dark\) \{\s*:root \{/);
const darkClass = tokens(/^\.dark \{/m);
const withRaisedRail = (theme: Record<string, string>): Record<string, string> => ({
  ...theme,
  "rail-raised": over(theme.rail!, "#ffffff", 0.1),
});
const themes = { light: withRaisedRail(light), dark: withRaisedRail({ ...light, ...darkClass }) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `color` laid over `base` at `alpha` (the rail's hover and selected rows are white/6…white/10 over it). */
function over(base: string, color: string, alpha: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) => Math.round(channel(base, i) * (1 - alpha) + channel(color, i) * alpha).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Text token → the background tokens it sits on (`rail-raised`: the rail under white/10). */
const PAIRS: [string, string[]][] = [
  ["foreground", ["background", "card", "raise"]],
  ["muted-foreground", ["background", "card", "raise"]],
  ["primary-foreground", ["primary"]],
  // Verde oliva as text (refs, icons) sits on cards; it stays the brand hex.
  ["primary", ["card"]],
  ["brand-ink", ["brand-soft", "background", "card", "raise"]],
  ["good", ["good-soft", "background", "card", "raise"]],
  ["yel", ["yel-soft", "background", "card", "raise"]],
  ["warn", ["warn-soft", "background", "card", "raise"]],
  ["bad", ["bad-soft", "background", "card", "raise"]],
  ["info", ["info-soft", "background", "card", "raise"]],
  ["destructive-foreground", ["bad"]],
  ["rail-foreground", ["rail", "rail-raised"]],
  ["rail-muted", ["rail", "rail-raised"]],
  ["rail-accent", ["rail"]],
  ["rail-bad", ["rail"]],
];

describe("theme contrast", () => {
  it("keeps the two dark blocks identical", () => {
    expect(darkMedia).toEqual(darkClass);
  });

  it("computes the WCAG ratio", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  for (const [mode, theme] of Object.entries(themes)) {
    for (const [text, backgrounds] of PAIRS) {
      for (const bg of backgrounds) {
        it(`${mode}: ${text} on ${bg} reaches 4.5:1`, () => {
          const fg = theme[text];
          const back = theme[bg];
          expect(fg, `--${text}`).toBeDefined();
          expect(back, `--${bg}`).toBeDefined();
          expect(contrast(fg!, back!)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});
