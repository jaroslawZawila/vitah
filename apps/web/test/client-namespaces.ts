// Static analysis behind i18n/client-messages.test.ts: which message paths ("purchasing",
// "construction.tabs"…) the client components under each route file read, so each layout's
// <ClientMessages> can be checked against them.
//
// From a route file (page, layout, error…) it follows what is really used, export by export:
// an imported name pulls in that export's top-level declaration and what it refers to, not the
// whole module (a page that imports `companyHref` from a file of hooks doesn't need their
// messages). Code counts as client code from a "use client" module down; "use server" modules
// are not followed. What a client module reads:
// - `useTranslations("path")`;
// - the namespaces handed to the components that take one (`FormError`, `FileSlot`,
//   `useConfirm`): any `namespace` / `errorNamespace` prop, property or default written as a
//   string, wherever it is written (a server page may pass it to a client component).
// `useTranslations` is recognised under any local name it is imported as (and as `intl.useTranslations`
// on a namespace import). A namespace held in a variable is read when it is a local `const` set to a
// string, or a prop called `namespace` / `errorNamespace` (its callers' strings are read instead).
// Anything this can't read is reported by `problems`, naming the file, so the test fails instead of
// missing it: a computed namespace, `useTranslations()` with none, `useMessages()` (all messages),
// next-intl re-exported, or an import it can't follow (another alias than `@/`, a missing file).
// `@repo/*` packages aren't followed: `packagesUsingNextIntl` says if one starts using next-intl.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const NAMESPACE_PROPS = new Set(["namespace", "errorNamespace"]);
/** next-intl and the library under it. */
const INTL = /^(next-intl|use-intl)(\/|$)/;
/** Hooks that read every message, not one namespace. */
const READ_ALL = new Set(["useMessages", "useExtracted"]);
/** Files the code imports that aren't code. */
const ASSET = /\.(css|scss|json|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|txt|md)$/;

type Ref = { file: string; name: string };
type Part = {
  names: string[];
  hooks: string[];
  props: string[];
  refs: Set<string>;
  dynamicImports: string[];
  sideEffect?: string;
};
type Module = {
  directive: "client" | "server" | null;
  imports: Map<string, Ref>;
  exports: Map<string, string | Ref>;
  starExports: string[];
  parts: Part[];
  always: Part[];
  problems: string[];
};

/** An installed package (or a Node built-in), looked up as Node does: in node_modules up from `root`. */
function isInstalled(root: string, spec: string): boolean {
  if (spec.startsWith("node:") || builtinModules.includes(spec.split("/")[0]!)) return true;
  const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
  for (let dir = root; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "node_modules", name))) return true;
    if (dirname(dir) === dir) return false;
  }
}

export function createAnalyzer(root: string, options: { readAllAllowed?: string[] } = {}) {
  const modules = new Map<string, Module>();

  /** The source file an import names; null for a package or a non-code file; "unresolved" if it can't be followed. */
  function resolveImport(from: string, spec: string): string | null | "unresolved" {
    let base: string;
    if (spec.startsWith("@/")) base = join(root, spec.slice(2));
    else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
    // next-intl itself is read where it's imported; @repo packages are checked by packagesUsingNextIntl.
    else if (INTL.test(spec) || spec.startsWith("@repo/") || isInstalled(root, spec)) return null;
    else return "unresolved"; // an alias this doesn't know (only `@/` is configured)
    if (ASSET.test(base)) return null;
    const bare = base.replace(/\.(m?js|jsx)$/, ""); // `./x.js` names x.ts under TypeScript's ESM resolution
    for (const c of [base, `${bare}.ts`, `${bare}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
      if (existsSync(c) && statSync(c).isFile() && /\.tsx?$/.test(c)) return c;
    }
    // A plain JavaScript module (lib/security-headers.js, which next.config.js reads too): not followed, so it
    // may not use next-intl itself.
    if (/\.(m?js|cjs)$/.test(base) && existsSync(base) && statSync(base).isFile()) {
      return /["'](next-intl|use-intl)(\/[^"']*)?["']/.test(readFileSync(base, "utf8")) ? "unresolved" : null;
    }
    return "unresolved";
  }

  function load(file: string): Module {
    const known = modules.get(file);
    if (known) return known;
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const first = sf.statements[0];
    const directive =
      first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && /^use (client|server)$/.test(first.expression.text)
        ? (first.expression.text.slice(4) as "client" | "server")
        : null;
    const m: Module = { directive, imports: new Map(), exports: new Map(), starExports: [], parts: [], always: [], problems: [] };
    const where = relative(root, file);
    const at = (node: ts.Node) => `${where}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const follow = (node: ts.Node, spec: string) => {
      const target = resolveImport(file, spec);
      if (target !== "unresolved") return target;
      m.problems.push(`${at(node)} can't follow import "${spec}"`);
      return null;
    };

    // How next-intl's hooks are named here: `useTranslations`, `useT` (imported as), `intl.useTranslations`.
    const hookNames = new Set<string>();
    const readAllNames = new Set<string>();
    const intlNamespaces = new Set<string>();
    const confirmNames = new Set<string>(["useConfirm"]);
    for (const st of sf.statements) {
      if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && INTL.test(st.moduleSpecifier.text)) {
        m.problems.push(`${at(st)} re-exports ${st.moduleSpecifier.text}: import it where it's used`);
      }
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.importClause?.isTypeOnly) continue;
      const bindings = st.importClause?.namedBindings;
      if (INTL.test(st.moduleSpecifier.text)) {
        if (bindings && ts.isNamespaceImport(bindings)) intlNamespaces.add(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            const imported = (el.propertyName ?? el.name).text;
            if (imported === "useTranslations") hookNames.add(el.name.text);
            if (READ_ALL.has(imported)) readAllNames.add(el.name.text);
          }
        }
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) if ((el.propertyName ?? el.name).text === "useConfirm") confirmNames.add(el.name.text);
      }
    }
    /** `useTranslations(…)` under whatever name it has here; also the hooks that read every message. */
    const intlCall = (callee: ts.Expression, names: Set<string>, members: Set<string> | string) =>
      (ts.isIdentifier(callee) && names.has(callee.text)) ||
      (ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        intlNamespaces.has(callee.expression.text) &&
        (typeof members === "string" ? callee.name.text === members : members.has(callee.name.text)));

    /** Where a name used at `node` is declared: a parameter (plain or a destructured prop) or a variable. */
    const declarationOf = (node: ts.Identifier) => {
      for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
        if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope)) {
          for (const st of scope.statements) {
            if (!ts.isVariableStatement(st)) continue;
            for (const d of st.declarationList.declarations) {
              if (ts.isIdentifier(d.name) && d.name.text === node.text) {
                const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
                return { kind: "variable" as const, value: isConst && d.initializer && ts.isStringLiteralLike(d.initializer) ? d.initializer.text : null };
              }
            }
          }
        }
        if (ts.isFunctionLike(scope)) {
          for (const param of scope.parameters) {
            if (ts.isIdentifier(param.name) && param.name.text === node.text) {
              return { kind: "parameter" as const, fn: scope.name && ts.isIdentifier(scope.name) ? scope.name.text : null };
            }
            if (ts.isObjectBindingPattern(param.name)) {
              for (const el of param.name.elements) {
                if (ts.isIdentifier(el.name) && el.name.text === node.text) {
                  return { kind: "prop" as const, prop: (el.propertyName ?? el.name).getText() };
                }
              }
            }
          }
        }
      }
      return { kind: "unknown" as const };
    };

    const scan = (node: ts.Node, names: string[]): Part => {
      const part: Part = { names, hooks: [], props: [], refs: new Set(), dynamicImports: [] };
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n)) {
          const callee = n.expression;
          const arg = n.arguments[0];
          if (intlCall(callee, hookNames, "useTranslations")) {
            if (arg && ts.isStringLiteralLike(arg)) part.hooks.push(arg.text);
            else if (arg && ts.isIdentifier(arg)) {
              const decl = declarationOf(arg);
              if (decl.kind === "variable" && decl.value !== null) part.hooks.push(decl.value);
              // FormError and FileSlot: their callers' `namespace="…"` is read instead.
              else if (decl.kind === "prop" && NAMESPACE_PROPS.has(decl.prop)) part.hooks.push("<namespace prop>");
              else m.problems.push(`${at(n)} useTranslations(${arg.text}): not a string this can read`);
            } else m.problems.push(`${at(n)} useTranslations(${arg?.getText() ?? ""}): not a string this can read`);
          }
          if (intlCall(callee, readAllNames, READ_ALL) && !options.readAllAllowed?.includes(where)) {
            m.problems.push(`${at(n)} ${callee.getText()}() reads every message`);
          }
          if (ts.isIdentifier(callee) && confirmNames.has(callee.text)) {
            if (arg && ts.isStringLiteralLike(arg)) part.props.push(arg.text);
            else m.problems.push(`${at(n)} ${callee.text}(${arg?.getText() ?? ""}): not a string this can read`);
          }
          if (callee.kind === ts.SyntaxKind.ImportKeyword && arg && ts.isStringLiteralLike(arg)) {
            const target = follow(n, arg.text);
            if (target) part.dynamicImports.push(target);
          }
        }
        // <FormError namespace="x" />, { errorNamespace: "x" }, ({ namespace = "x" }) => …, { namespace }
        const named =
          (ts.isJsxAttribute(n) || ts.isPropertyAssignment(n) || ts.isBindingElement(n) || ts.isParameter(n) || ts.isShorthandPropertyAssignment(n)) &&
          NAMESPACE_PROPS.has(n.name.getText());
        if (named) {
          const value = ts.isShorthandPropertyAssignment(n)
            ? n.name
            : n.initializer && ts.isJsxExpression(n.initializer)
              ? n.initializer.expression
              : n.initializer;
          if (value && ts.isStringLiteralLike(value)) part.props.push(value.text);
          else if (value && ts.isIdentifier(value)) {
            const decl = declarationOf(value);
            if (decl.kind === "variable" && decl.value !== null) part.props.push(decl.value);
            // Passed on as is: its value was read where it was written (the callers' prop, or useConfirm's argument).
            else if (decl.kind === "prop" && NAMESPACE_PROPS.has(decl.prop)) {
              /* read at the callers */
            } else if (decl.kind === "parameter" && decl.fn !== null && confirmNames.has(decl.fn)) {
              /* read at useConfirm's callers */
            } else m.problems.push(`${at(n)} ${n.getText()}: not a string this can read`);
          } else if (value) m.problems.push(`${at(n)} ${n.getText()}: not a string this can read`);
        }
        if (ts.isIdentifier(n)) part.refs.add(n.text);
        ts.forEachChild(n, visit);
      };
      visit(node);
      return part;
    };

    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) {
        const clause = st.importClause;
        if (clause?.isTypeOnly || !ts.isStringLiteral(st.moduleSpecifier)) continue;
        const target = follow(st, st.moduleSpecifier.text);
        if (!target) continue;
        if (!clause) {
          m.always.push({ names: [], hooks: [], props: [], refs: new Set(), dynamicImports: [], sideEffect: target });
          continue;
        }
        if (clause.name) m.imports.set(clause.name.text, { file: target, name: "default" });
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) m.imports.set(bindings.name.text, { file: target, name: "*" });
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) if (!el.isTypeOnly) m.imports.set(el.name.text, { file: target, name: (el.propertyName ?? el.name).text });
        }
        continue;
      }
      if (ts.isExportDeclaration(st)) {
        if (st.isTypeOnly) continue;
        const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
        const target = spec ? follow(st, spec) : null;
        if (spec && !target) continue;
        if (!st.exportClause) {
          if (target) m.starExports.push(target);
        } else if (ts.isNamespaceExport(st.exportClause)) {
          if (target) m.exports.set(st.exportClause.name.text, { file: target, name: "*" });
        } else {
          for (const el of st.exportClause.elements) {
            if (el.isTypeOnly) continue;
            const local = (el.propertyName ?? el.name).text;
            m.exports.set(el.name.text, target ? { file: target, name: local } : local);
          }
        }
        continue;
      }
      if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) continue;
      if (ts.isExportAssignment(st)) {
        m.parts.push(scan(st.expression, ["*default"]));
        m.exports.set("default", "*default");
        continue;
      }
      let names: string[] = [];
      if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) names = [st.name.text];
      if (ts.isVariableStatement(st)) {
        const collect = (b: ts.BindingName): string[] =>
          ts.isIdentifier(b) ? [b.text] : b.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : collect(e.name)));
        names = st.declarationList.declarations.flatMap((d) => collect(d.name));
      }
      const part = scan(st, names);
      // Statements that declare nothing (and an anonymous default export) always run.
      if (names.length === 0) {
        m.always.push(part);
        continue;
      }
      m.parts.push(part);
      const modifiers = ts.canHaveModifiers(st) ? (ts.getModifiers(st) ?? []) : [];
      if (modifiers.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword)) {
        const isDefault = modifiers.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword);
        for (const n of names) m.exports.set(isDefault ? "default" : n, n);
      }
    }
    modules.set(file, m);
    return m;
  }

  /** The message paths read by the client code a route file renders. */
  function pathsUsed(entry: string): Set<string> {
    const out = new Set<string>();
    const seen = new Set<string>();
    type Item = { file: string; name: string; client: boolean } | { m: Module; part: Part; file: string; client: boolean };
    const queue: Item[] = [{ file: entry, name: "*", client: false }];

    const take = (m: Module, file: string, part: Part, client: boolean) => {
      const key = `${file}#${m.parts.indexOf(part)}:${m.always.indexOf(part)}|${client}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (client) for (const h of part.hooks) if (h !== "<namespace prop>") out.add(h);
      for (const p of part.props) out.add(p);
      if (part.sideEffect) queue.push({ file: part.sideEffect, name: "*side", client });
      for (const d of part.dynamicImports) queue.push({ file: d, name: "*", client });
      for (const r of part.refs) {
        const imported = m.imports.get(r);
        if (imported) queue.push({ ...imported, client });
        for (const p of m.parts) if (p !== part && p.names.includes(r)) queue.push({ m, part: p, file, client });
      }
    };

    while (queue.length) {
      const item = queue.shift()!;
      if ("part" in item) {
        take(item.m, item.file, item.part, item.client);
        continue;
      }
      const m = load(item.file);
      if (m.directive === "server") continue; // server actions: a reference, not rendered
      const client = item.client || m.directive === "client";
      const key = `${item.file}:${item.name}|${client}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const p of m.always) take(m, item.file, p, client);
      if (item.name === "*side") continue;
      const names = item.name === "*" ? [...m.exports.keys()] : [item.name];
      if (item.name === "*" || !m.exports.has(item.name)) for (const s of m.starExports) queue.push({ file: s, name: item.name, client });
      for (const n of names) {
        const e = m.exports.get(n);
        if (e === undefined) continue;
        if (typeof e === "object") {
          queue.push({ ...e, client });
          continue;
        }
        for (const p of m.parts) if (p.names.includes(e)) queue.push({ m, part: p, file: item.file, client });
        const imported = m.imports.get(e);
        if (imported) queue.push({ ...imported, client });
      }
    }
    return out;
  }

  /** Everything this analysis can't read, in the given source files, each with its file and line. */
  function problems(files: string[]): string[] {
    return files.flatMap((f) => load(f).problems);
  }

  return { pathsUsed, problems, resolveImport };
}

/** The app's route files that render something: pages, layouts and the error / not-found / loading pages. */
export function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "api" || e.name.startsWith(".") ? [] : routeFiles(path);
    return /^(page|layout|error|not-found|loading|template|default|forbidden|unauthorized)\.tsx$/.test(e.name) ? [path] : [];
  });
}

/** The app's source files, tests aside. */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : sourceFiles(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts") ? [path] : [];
  });
}

/** Files of the `@repo/*` packages (under `packagesDir`) that import next-intl: the analysis doesn't follow them. */
export function packagesUsingNextIntl(packagesDir: string): string[] {
  return sourceFiles(packagesDir)
    .filter((f) => /from\s+["'](next-intl|use-intl)(\/[^"']*)?["']|import\(\s*["'](next-intl|use-intl)/.test(readFileSync(f, "utf8")))
    .map((f) => relative(packagesDir, f));
}
