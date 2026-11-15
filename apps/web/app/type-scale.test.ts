// Guards the portal's type scale (globals.css): text is 12 px at the least (labels, eyebrows, pills, table
// headings), 13 px (`text-meta`) for secondary text, 14 px (`text-sm`) for reading text. Below 14 px a view
// uses those tokens, never an arbitrary `text-[Npx]`, and nothing in the stylesheet sets a size under 12 px.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : sources(path);
    return /\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

const files = ["app", "components", "lib"].flatMap((d) => sources(join(root, d)));

/** Every font size written in px: `text-[13px]` in a class, `font-size: 13px` in CSS. */
function sizes(source: string): number[] {
  return [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]|font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1] ?? m[2]));
}

describe("type scale", () => {
  it("finds the portal's sources", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("sets no font size under 12 px", () => {
    const small = files.flatMap((f) => sizes(readFileSync(f, "utf8")).filter((n) => n < 12).map((n) => `${relative(root, f)}: ${n}px`));
    expect(small).toEqual([]);
  });

  it("uses text-xs, text-meta or text-sm below 14 px, not an arbitrary size", () => {
    const arbitrary = files
      .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].filter((m) => Number(m[1]) < 14).map((m) => `${relative(root, f)}: ${m[0]}`));
    expect(arbitrary).toEqual([]);
  });
});
