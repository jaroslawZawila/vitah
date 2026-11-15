// The static analysis behind i18n/client-messages.test.ts, on small made-up sources: each way of
// reaching a message it must either follow or report (with the file), never miss in silence.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createAnalyzer, packagesUsingNextIntl } from "./client-namespaces";

const root = mkdtempSync(join(tmpdir(), "client-namespaces-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Writes the files (path → source) and returns a fresh analyzer over them. */
function project(files: Record<string, string>) {
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return createAnalyzer(root);
}
const page = (dir: string) => join(root, dir, "page.tsx");

describe("client namespaces analysis", () => {
  it("reads useTranslations imported under another name, or through a namespace import", () => {
    const a = project({
      "renamed/View.tsx": `"use client";
import { useTranslations as useT } from "next-intl";
import * as intl from "next-intl";
export default function View() {
  const t = useT("alpha.beta");
  const u = intl.useTranslations("gamma");
  return t("x") + u("y");
}`,
      "renamed/page.tsx": `import View from "./View";
export default function Page() { return <View />; }`,
    });
    expect(a.pathsUsed(page("renamed"))).toEqual(new Set(["alpha.beta", "gamma"]));
    expect(a.problems([join(root, "renamed/View.tsx")])).toEqual([]);
  });

  it("reports a hook that reads every message", () => {
    const a = project({
      "all/View.tsx": `"use client";
import { useMessages as useAll } from "next-intl";
export default function View() { return JSON.stringify(useAll()); }`,
    });
    expect(a.problems([join(root, "all/View.tsx")])).toEqual(["all/View.tsx:3 useAll() reads every message"]);
  });

  it("reports next-intl re-exported from the app's own module", () => {
    const a = project({ "lib/intl.ts": `export { useTranslations } from "next-intl";` });
    expect(a.problems([join(root, "lib/intl.ts")])).toEqual(['lib/intl.ts:1 re-exports next-intl: import it where it\'s used']);
  });

  it("reads a namespace held in a local const, and reports one that isn't a string it can read", () => {
    const a = project({
      "local/View.tsx": `"use client";
import { useTranslations } from "next-intl";
const namespace = "delta";
export default function View() { return useTranslations(namespace)("x"); }`,
      "local/page.tsx": `import View from "./View";
export default function Page() { return <View />; }`,
      "local/Bad.tsx": `"use client";
import { useTranslations } from "next-intl";
export function Computed({ flag }: { flag: boolean }) {
  const namespace = flag ? "a" : "b";
  return useTranslations(namespace)("x");
}
export function Reassigned() {
  let namespace = "a";
  namespace = "b";
  return useTranslations(namespace)("x");
}
export function useHook(namespace: string) {
  return useTranslations(namespace);
}
export function Renamed({ ns: namespace }: { ns: string }) {
  return useTranslations(namespace)("x");
}`,
    });
    expect(a.pathsUsed(page("local"))).toEqual(new Set(["delta"]));
    expect(a.problems([join(root, "local/View.tsx")])).toEqual([]);
    expect(a.problems([join(root, "local/Bad.tsx")])).toEqual([
      "local/Bad.tsx:5 useTranslations(namespace): not a string this can read",
      "local/Bad.tsx:10 useTranslations(namespace): not a string this can read",
      "local/Bad.tsx:13 useTranslations(namespace): not a string this can read",
      "local/Bad.tsx:16 useTranslations(namespace): not a string this can read",
    ]);
  });

  it("reads a `namespace` prop at its callers, a local const handed on as one, and reports anything else", () => {
    const a = project({
      "props/FormError.tsx": `"use client";
import { useTranslations } from "next-intl";
export default function FormError({ namespace }: { namespace: string }) { return useTranslations(namespace)("generic"); }`,
      "props/page.tsx": `import FormError from "./FormError";
export default function Page({ flag }: { flag: boolean }) {
  const local = "zeta.errors";
  const chosen = flag ? "a.errors" : "b.errors";
  return <><FormError namespace="eta.errors" /><FormError namespace={local} /><FormError errorNamespace={chosen} /></>;
}`,
    });
    expect(a.pathsUsed(page("props"))).toEqual(new Set(["eta.errors", "zeta.errors"]));
    expect(a.problems([join(root, "props/page.tsx"), join(root, "props/FormError.tsx")])).toEqual([
      "props/page.tsx:5 errorNamespace={chosen}: not a string this can read",
    ]);
  });

  it("follows `.js` imports of TypeScript files", () => {
    const a = project({
      "js/View.tsx": `"use client";
import { useTranslations } from "next-intl";
export default function View() { return useTranslations("theta")("x"); }`,
      "js/page.tsx": `import View from "./View.js";
export default function Page() { return <View />; }`,
    });
    expect(a.pathsUsed(page("js"))).toEqual(new Set(["theta"]));
    expect(a.problems([page("js")])).toEqual([]);
  });

  it("leaves a plain JavaScript module alone, unless it uses next-intl", () => {
    const a = project({
      "plain/headers.js": `export const HEADERS = [];`,
      "plain/words.js": `import { useTranslations } from "next-intl";
export const words = () => useTranslations("kappa");`,
      "plain/page.tsx": `import { HEADERS } from "./headers.js";
import { words } from "./words.js";
export default function Page() { return <p>{HEADERS.length}{String(words)}</p>; }`,
    });
    expect(a.problems([page("plain")])).toEqual(['plain/page.tsx:2 can\'t follow import "./words.js"']);
  });

  it("reports an import it can't follow: another alias than @/, or a missing file", () => {
    const a = project({
      "alias/page.tsx": `import View from "~/components/View";
import Gone from "./Gone";
import "./styles.css";
export default function Page() { return <><View /><Gone /></>; }`,
    });
    expect(a.problems([page("alias")])).toEqual([
      'alias/page.tsx:1 can\'t follow import "~/components/View"',
      'alias/page.tsx:2 can\'t follow import "./Gone"',
    ]);
  });

  it("finds a @repo package that imports next-intl", () => {
    project({
      "packages/ui/src/Label.tsx": `import { useTranslations } from "next-intl";
export const Label = () => useTranslations("iota")("x");`,
      "packages/core/src/plain.ts": `export const plain = 1;`,
    });
    expect(packagesUsingNextIntl(join(root, "packages"))).toEqual(["ui/src/Label.tsx"]);
  });
});
