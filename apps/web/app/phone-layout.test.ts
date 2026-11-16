// Guards two rules of the portal's phone layout (CLAUDE.md, "Mobile-first responsive design").
//
// 1. A strip that scrolls sideways is positioned (`relative`). An `sr-only` or absolutely positioned child is
//    otherwise placed against the page, escapes the strip's clip and makes the whole page scroll sideways: one
//    hidden "3 abiertas" label in the Obra tab strip once made every Obra page 134 px wider than a phone.
//    A strip left unpositioned on purpose says why in a `scroll-ok:` comment just above it.
// 2. The classes that make a text link 44 px tall for a finger are written once, in
//    `app/dashboard/components/touch.ts` (`touchLink`), and used from there, so the rule cannot drift.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : sources(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

const files = ["app", "components"].flatMap((d) => sources(join(root, d)));

/** The class strings of a source that make a sideways scroller, with the line each starts on. */
function scrollers(source: string): { line: number; classes: string; excused: boolean }[] {
  return [...source.matchAll(/(["'`])((?:(?!\1)[^\n])*\boverflow-(?:x-)?auto\b(?:(?!\1)[^\n])*)\1/g)].map((m) => {
    const before = source.slice(0, m.index);
    const line = before.split("\n").length;
    // The comment block directly above the string's statement may excuse it.
    const above = before.split("\n").slice(-8).join("\n");
    return { line, classes: m[2] ?? "", excused: /scroll-ok:\s*\S/.test(above) };
  });
}

/** Positioned at the widths where it scrolls: `relative`, or the same variant on both (`max-lg:relative`). */
function positioned(classes: string): boolean {
  return /(?:^|\s)(?:[\w-]+:)*(?:relative|absolute|fixed|sticky)(?:\s|$)/.test(classes);
}

describe("phone layout guards", () => {
  it("finds the portal's sources", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("positions every sideways scroller, so a hidden or absolute child cannot widen the page", () => {
    const loose = files.flatMap((f) =>
      scrollers(readFileSync(f, "utf8"))
        .filter((s) => !positioned(s.classes) && !s.excused)
        .map((s) => `${relative(root, f)}:${s.line}: ${s.classes}`),
    );
    expect(loose).toEqual([]);
  });

  it("writes the touch-link classes once, in touch.ts", () => {
    const pasted = files
      .filter((f) => !f.endsWith(join("dashboard", "components", "touch.ts")))
      .filter((f) => /pointer-coarse:inline-flex\s+pointer-coarse:min-h-11/.test(readFileSync(f, "utf8")))
      .map((f) => relative(root, f));
    expect(pasted).toEqual([]);
  });
});
