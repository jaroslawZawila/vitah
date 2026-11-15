// Guards i18n/client-messages.ts: every client component gets the messages it reads from the
// <ClientMessages> of the layouts above it, as the browser merges them (a missing one would show
// its key, or throw); no layout sends what nothing under it reads, or what a layout above it
// already sent; each level's own part stays within its budget. The reading is static
// (test/client-namespaces.ts): the namespace in each `useTranslations("…")` of a client
// component, and the namespaces handed to FormError / FileSlot / useConfirm.
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createAnalyzer, packagesUsingNextIntl, routeFiles, sourceFiles } from "../test/client-namespaces";
import en from "../messages/en.json";
import es from "../messages/es.json";
import { CLIENT_MESSAGES, clientMessagePaths, pathsAbove, pickMessages, scopeMessages, type MessageScope } from "./client-messages";
import { mergeMessages, type Messages } from "./merge-messages";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = join(root, "app");
// NestedMessages merges the levels' messages: the one place that reads them all.
const analyzer = createAnalyzer(root, { readAllAllowed: ["i18n/NestedMessages.tsx"] });
const scopes = Object.keys(CLIENT_MESSAGES) as MessageScope[];

/** A route file's folder under app/, as the scopes are written ("" for app/ itself). */
const folderOf = (file: string) => relative(appDir, dirname(file)).split("\\").join("/");
const isUnder = (folder: string, scope: string) => scope === "" || folder === scope || folder.startsWith(`${scope}/`);
/** The nearest layout above a route file that sets its client messages. */
const scopeOf = (file: string) => scopes.filter((s) => isUnder(folderOf(file), s)).sort((a, b) => b.length - a.length)[0]!;
/** `path` is given by one of `given` (itself, or a namespace containing it). */
const covers = (given: readonly string[], path: string) => given.some((g) => path === g || path.startsWith(`${g}.`));

const routes = routeFiles(appDir).sort();
const used = new Map(routes.map((r) => [r, analyzer.pathsUsed(r)]));
/** What the route files directly under a scope (not under a deeper one) read. */
const directNeeds = (scope: MessageScope) => new Set(routes.filter((r) => scopeOf(r) === scope).flatMap((r) => [...used.get(r)!]));
const subtreeNeeds = (scope: MessageScope) =>
  new Set(routes.filter((r) => isUnder(scopeOf(r), scope)).flatMap((r) => [...used.get(r)!]));
const lookup = (messages: object, path: string) =>
  path.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), messages);
const locales = { es, en } as Record<string, Messages>;
/** The levels from the root down to `scope`. */
const chain = (scope: MessageScope) => scopes.filter((s) => s === scope || isUnder(scope, s)).sort((a, b) => a.length - b.length);
/** What a scope's client components see in the browser: each level's part laid over those above. */
const merged = (locale: Messages, scope: MessageScope) => chain(scope).reduce((all, s) => mergeMessages(all, scopeMessages(locale, s)), {} as Messages);
/** Every message (leaf) in a tree, by its full path. */
const leaves = (node: unknown, prefix = ""): string[] =>
  node && typeof node === "object" && !Array.isArray(node)
    ? Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
    : [prefix];
const size = (messages: Messages) => JSON.stringify(messages).length;

describe("client messages", () => {
  it("finds the route files and what they read", () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(used.get(join(appDir, "page.tsx"))).toEqual(new Set(["login"]));
    expect(used.get(join(appDir, "dashboard/compras/page.tsx"))).toContain("purchasing");
  });

  it("leaves the last-resort error page to its own text: no layout, so no messages, is above it", () => {
    expect(analyzer.pathsUsed(join(appDir, "global-error.tsx"))).toEqual(new Set());
  });

  it("can read every namespace a component asks for, and follow every import", () => {
    expect(analyzer.problems(["app", "components", "lib", "i18n"].flatMap((d) => sourceFiles(join(root, d))))).toEqual([]);
  });

  it("has no @repo package using next-intl (the analysis doesn't follow them)", () => {
    expect(packagesUsingNextIntl(join(root, "../../packages"))).toEqual([]);
  });

  it("gives every client component the messages it reads", () => {
    const missing = routes.flatMap((r) => {
      const given = clientMessagePaths(scopeOf(r));
      const lacking = [...used.get(r)!].filter((p) => !covers(given, p));
      return lacking.length ? [`${relative(root, r)} (scope "${scopeOf(r)}"): ${lacking.sort().join(", ")}`] : [];
    });
    expect(missing).toEqual([]);
  });

  it("has every message a client component reads in the browser, whole, once the levels are merged", () => {
    const missing = Object.entries(locales).flatMap(([name, locale]) =>
      routes.flatMap((r) => {
        const seen = merged(locale, scopeOf(r));
        return [...used.get(r)!].filter((p) => !isDeepStrictEqual(lookup(seen, p), lookup(locale, p))).map((p) => `${name} ${relative(root, r)}: ${p}`);
      }),
    );
    expect(missing).toEqual([]);
  });

  it("sends no message twice down one branch: a level leaves out what a level above it sent", () => {
    const twice = Object.entries(locales).flatMap(([name, locale]) =>
      scopes.flatMap((scope) => {
        const own = new Set(leaves(scopeMessages(locale, scope)));
        return chain(scope)
          .filter((s) => s !== scope)
          .flatMap((above) => leaves(scopeMessages(locale, above)).filter((leaf) => own.has(leaf)).map((leaf) => `${name} "${scope}" and "${above}": ${leaf}`));
      }),
    );
    expect(twice).toEqual([]);
  });

  it("names only messages that exist, in both languages", () => {
    const paths = new Set([...scopes.flatMap((s) => CLIENT_MESSAGES[s]), ...[...used.values()].flatMap((u) => [...u])]);
    const unknown = [...paths].flatMap((p) => [
      ...(lookup(es, p) === undefined ? [`es: ${p}`] : []),
      ...(lookup(en, p) === undefined ? [`en: ${p}`] : []),
    ]);
    expect(unknown).toEqual([]);
  });

  it("sends nothing that nothing under the layout reads, each path from the deepest layout that needs it", () => {
    const misplaced = scopes.flatMap((scope) => {
      const above = scopes.filter((s) => s !== scope && isUnder(scope, s)).flatMap((s) => CLIENT_MESSAGES[s]);
      const children = scopes.filter((s) => s !== scope && isUnder(s, scope) && scopes.filter((p) => p !== s && isUnder(s, p)).sort((a, b) => b.length - a.length)[0] === scope);
      const reads = (needs: Set<string>, path: string) => [...needs].some((n) => n === path || n.startsWith(`${path}.`) || path.startsWith(`${n}.`));
      return CLIENT_MESSAGES[scope].flatMap((path: string) => {
        if (covers(above, path)) return [`"${scope}": ${path} is already given above`];
        if (!reads(subtreeNeeds(scope), path)) return [`"${scope}": nothing under it reads ${path}`];
        // Higher than needed only when the level itself or two of its sections read it.
        const sections = children.filter((c) => reads(subtreeNeeds(c), path));
        if (!reads(directNeeds(scope), path) && sections.length < 2) return [`"${scope}": only "${sections[0]}" reads ${path}: give it there`];
        return [];
      });
    });
    expect(misplaced).toEqual([]);
  });

  it("gives the login page only its own messages", () => {
    const signedOut = routes.filter((r) => scopeOf(r) === "");
    const needs = new Set(signedOut.flatMap((r) => [...used.get(r)!]));
    expect(clientMessagePaths("")).toEqual([...needs].sort());
    for (const locale of Object.values(locales)) {
      expect(Object.keys(scopeMessages(locale, ""))).toEqual(["errorPages", "login"]);
      expect(size(scopeMessages(locale, ""))).toBeLessThan(3_000);
    }
  });

  // What each level itself sends, in bytes of JSON: the frame goes with every portal page, and a
  // section's part again each time a page renders its layout anew.
  const BUDGET: Partial<Record<MessageScope, number>> = { "": 3_000, dashboard: 7_000 };
  const SECTION_BUDGET = 60_000;
  it("keeps what each level adds within its budget", () => {
    const over = Object.entries(locales).flatMap(([name, locale]) =>
      scopes.flatMap((scope) => {
        const bytes = size(scopeMessages(locale, scope));
        const budget = BUDGET[scope] ?? SECTION_BUDGET;
        return bytes > budget ? [`${name} "${scope}": ${bytes} > ${budget}`] : [];
      }),
    );
    expect(over).toEqual([]);
  });

  // Each scope is one layout's, and that layout wraps all it renders in it: what the layout itself
  // shows (the rail, the top bar) is read with the layout's own messages.
  it("has each scope set by its own layout, around everything the layout renders", () => {
    const layouts = routes.filter((r) => r.endsWith("layout.tsx"));
    const declared = layouts.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/<ClientMessages\s+scope="([^"]*)"/g)].map((m) => ({ file, scope: m[1] }));
    });
    expect(declared.map((d) => d.scope).sort()).toEqual([...scopes].sort());
    for (const { file, scope } of declared) expect(scope, relative(root, file)).toBe(folderOf(file));

    const outside = layouts.flatMap((file) => {
      const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      if (!sf.text.includes("<ClientMessages")) return [];
      const local = new Set<string>();
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue;
        const target = analyzer.resolveImport(file, st.moduleSpecifier.text);
        if (!target || target === "unresolved") continue;
        const { name, namedBindings } = st.importClause;
        if (name) local.add(name.text);
        if (namedBindings && ts.isNamedImports(namedBindings)) for (const el of namedBindings.elements) local.add(el.name.text);
      }
      local.delete("ClientMessages");
      const found: string[] = [];
      const visit = (n: ts.Node, inside: boolean) => {
        const tag = ts.isJsxElement(n) ? n.openingElement.tagName : ts.isJsxSelfClosingElement(n) ? n.tagName : null;
        const name = tag?.getText();
        if (name && local.has(name) && !inside) found.push(`${relative(root, file)}: <${name}> outside <ClientMessages>`);
        ts.forEachChild(n, (c) => visit(c, inside || name === "ClientMessages"));
      };
      visit(sf, false);
      return found;
    });
    expect(outside).toEqual([]);
  });

  it("uses no other provider of messages", () => {
    const providers = ["app", "components", "lib", "i18n"]
      .flatMap((d) => sourceFiles(join(root, d)))
      .filter((f) => readFileSync(f, "utf8").includes("NextIntlClientProvider"))
      .map((f) => relative(root, f));
    expect(providers.sort()).toEqual(["i18n/ClientMessages.tsx", "i18n/NestedMessages.tsx"]);
  });
});

describe("pickMessages", () => {
  const messages = { a: { b: "B", c: { d: "D" } }, e: "E", f: { g: "G" } };

  it("keeps only the given paths", () => {
    expect(pickMessages(messages, ["a.c", "e"])).toEqual({ a: { c: { d: "D" } }, e: "E" });
  });

  it("takes a whole namespace once, whatever else names a part of it, and changes nothing", () => {
    expect(pickMessages(messages, ["a.c", "a", "a.b"])).toEqual({ a: messages.a });
    expect(messages).toEqual({ a: { b: "B", c: { d: "D" } }, e: "E", f: { g: "G" } });
  });

  it("skips a path the catalogue lacks", () => {
    expect(pickMessages(messages, ["x.y", "f.g"])).toEqual({ f: { g: "G" } });
  });
});

describe("scopeMessages", () => {
  it("sends a level's own paths less those of the levels above it", () => {
    expect(pathsAbove("dashboard/projects/[id]/obra")).toEqual(expect.arrayContaining(["construction.scheduleStatus", "construction.photos"]));
    const obra = scopeMessages(es, "dashboard/projects/[id]/obra");
    const construction = lookup(obra, "construction") as Messages;
    expect(construction.scheduleStatus).toBeUndefined();
    expect(construction.photos).toBeUndefined();
    expect(construction.tabs).toEqual(es.construction.tabs);
    // The catalogue itself is untouched.
    expect(es.construction.scheduleStatus).toBeDefined();
    expect(es.construction.photos).toBeDefined();
  });

  it("sends the root's paths as they are", () => {
    expect(scopeMessages(es, "")).toEqual({ errorPages: es.errorPages, login: es.login });
  });
});

describe("mergeMessages", () => {
  it("lays one tree over another, deeply, changing neither", () => {
    const above = { a: { b: "B" }, c: "C" };
    const own = { a: { d: { e: "E" } }, f: "F" };
    const before = JSON.stringify([above, own]);
    expect(mergeMessages(above, own)).toEqual({ a: { b: "B", d: { e: "E" } }, c: "C", f: "F" });
    expect(JSON.stringify([above, own])).toBe(before);
  });

  it("shares the groups only one side has", () => {
    const above = { a: { b: "B" }, c: { x: "X" } };
    const own = { d: { e: "E" } };
    const result = mergeMessages(above, own);
    expect(result.c).toBe(above.c);
    expect(result.d).toBe(own.d);
  });
});
