// The soft-delete guard's analyser (run by ./soft-delete-guard.test.ts). Deletes are soft (CLAUDE.md › Database): a
// deleted row keeps its place with `deleted_at` set, and every read must leave it out, as if it were gone. This reads
// the source with the TypeScript compiler (syntax only, no type checking) and finds every place that reads one of the
// soft-deleted tables (every `pgTable` of schema.ts with a `deletedAt` column), in the ways this codebase reads one:
//   - Drizzle builders: `.from(t)`, `.innerJoin|leftJoin|rightJoin|fullJoin|crossJoin(t, on)`, `$count(t, where)`;
//   - relational queries: `db.query.t.findFirst|findMany({ where, with })`, the options and every `with` followed
//     through consts, spreads and local functions (a `with` it can't read fails), relations read from schema.ts;
//   - raw SQL: each place a `sql` template names the table: `${t}` or its SQL name (schema-qualified or not) after
//     from / join / update, comma lists included; a fragment built apart (a const, `sql.join([...])`, a function) is
//     read on its own; `sql.raw` naming the table always fails;
//   - and `delete(t)`, which always fails: a soft-deleted table is never purged.
// Each source of a query is told apart by its binding, not its table: `alias(t, "a")` and `alias(t, "b")` are two.
// Drizzle writes (`update(t)`) are not checked: each runs after the read that found its row. A raw `update` that
// names the table is read like any statement.
//
// A read passes when its conditions (where, having, an inner join's on, `$count`'s, the relational `where`; a left
// join's on only for the rows of the table it joins; a select list never) prove both:
//   1. its deleted rows are left out: `isNull(t.deletedAt)` on that very source, `${t.deletedAt} is null`, in raw SQL
//      `alias.deleted_at is null` (or `name.` / bare when unaliased) in a where/on of the table's own select, or a
//      helper that does (`projectNotDeleted`, `projectInTenant`, a local `notDeleted`…);
//   2. and, for a table under a project (all but `projects`), a deleted project's rows are left out: a condition on
//      `projects.deleted_at` (`projectIdsInTenant`, `inLiveProject`, `inLiveOrder`, `projectInTenant`, an inner join
//      to `projects` with its check…), or else the read is narrowed by value to one project's rows:
//      `eq|inArray(x.col, <value>)` where `col` is `id` of a table under a project, `projectId`, or a key to a table
//      under a project (schema.ts' references), and `<value>` an identifier, literal or property of a value, never a
//      column or a subquery. That parent (or row) is trusted to have been checked by the caller (`requireOrder`…),
//      which the query alone can't show. In raw SQL it is decided per select: its own conditions, a subquery in its
//      where, the CTE it reads, or the select it is nested in.
// `or(a, b)` proves what both a and b prove; a condition under `not`, `ne`, `notInArray`, `notExists`… (`or`/`not` in
// raw SQL), behind `&&`/`||`/`??`, or in one branch of `?:` only, proves nothing. Conditions are followed into consts (and the `.push(…)`es at their own
// level), spreads and helpers called by name (every `return` of a helper must prove it); a reassigned variable proves
// nothing. A builder kept in a const (`$dynamic()` or not), or returned by a local arrow, takes what every use of it
// adds. What a subquery proves counts for the outer query, except about the sources it reads itself.
//
// A read that deliberately sees deleted rows (Elementos eliminados, a restore's checks, a uniqueness check, a seed)
// names the tables it excuses in a marker just before its statement or inside its query:
// `// soft-delete-ok(projectDocuments, projects): <reason>`. It covers that one query; it fails without a reason or
// a table, or with a table its query doesn't read or reads correctly anyway.
import ts from "typescript";
import { dirname, resolve } from "node:path";

export type SourceFile = { path: string; text: string };

export type Table = {
  /** The schema's export name: `projectDocuments`. */
  name: string;
  /** Its SQL name: `project_documents`. */
  sql: string;
  soft: boolean;
  /** Under a project: `projects`, a table with `projectId`, or one with a key to such a table. */
  underProject: boolean;
  /** Columns that narrow it to one project's rows: `id` (under a project), `projectId`, keys to tables under one. */
  scoping: Set<string>;
  /** The same, by SQL name. */
  scopingSql: Set<string>;
};

export type Schema = {
  tables: Map<string, Table>;
  /** The soft-deleted ones. */
  soft: string[];
  /** `${table}.${relation}` → the table it reaches. */
  relations: Map<string, string>;
};

export type ReadKind = "select" | "join" | "count" | "query" | "with" | "sql" | "raw" | "delete";

export type Read = {
  file: string;
  line: number;
  table: string;
  kind: ReadKind;
  /** Rule 1 holds. */
  rows: boolean;
  /** Rule 2: `live` by a deleted-project check, `parent` narrowed by value, `n/a` for `projects`. */
  project: "live" | "parent" | "n/a" | "missing";
  /** The marker's reason, when one excuses it. */
  marker?: string;
};

export type Problem = { file: string; line: number; message: string };

export type Report = { reads: Read[]; problems: Problem[] };

const MARKER = /soft-delete-ok\b(?:\(([^)]*)\))?\s*:?([^\n]*)/;
/** Conditions under which nothing proves anything (`or` proves what all its branches prove). */
const WEAK = new Set(["not", "ne", "notInArray", "notExists", "notLike", "notIlike", "notBetween"]);
const QUERY_METHODS: Record<string, ReadKind> = {
  from: "select",
  innerJoin: "join",
  leftJoin: "join",
  rightJoin: "join",
  fullJoin: "join",
  crossJoin: "join",
  $count: "count",
  delete: "delete",
};
const SQL_ALIAS_STOP = new Set(
  "where join on left right inner full cross order group limit set using union natural lateral and or having window offset for returning values select except intersect outer as".split(" "),
);
const snake = (camel: string) => camel.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

// ─── The schema ──────────────────────────────────────────────────────────────

/**
 * Every `pgTable`: its columns' SQL names and what they reference, which tables are soft-deleted and under a project;
 * the relations. `text` is the whole schema (its entry and every module, as one text). A column references a table by
 * `.references(() => t.id)` on itself, or by a key in the table's extra config: `foreignKey({ columns: [table.tenantId,
 * table.projectId], foreignColumns: [projects.tenantId, projects.id] })`, written there or returned by a helper of the
 * schema's (`underProject(name, table)`): each column paired with a foreign `id` references that table.
 */
export function readSchema(text: string): Schema {
  const sf = ts.createSourceFile("schema.ts", text, ts.ScriptTarget.Latest, true);
  const raw = new Map<string, { sql: string; columns: Map<string, { sql: string; references?: string }> }>();
  const relations = new Map<string, string>();

  /** `foreignKey({ columns, foreignColumns })`: [column, table] for each column paired with a foreign `id`. */
  const keyPairs = (call: ts.CallExpression): [string, string][] => {
    const [arg] = call.arguments;
    if (!arg || !ts.isObjectLiteralExpression(arg)) return [];
    const list = (name: string) => {
      const p = arg.properties.find((x) => ts.isPropertyAssignment(x) && x.name.getText(sf) === name);
      return p && ts.isPropertyAssignment(p) && ts.isArrayLiteralExpression(p.initializer) ? p.initializer.elements : undefined;
    };
    const columns = list("columns");
    const foreign = list("foreignColumns");
    if (!columns || !foreign) return [];
    return columns.flatMap((c, i) => {
      const f = foreign[i];
      if (!ts.isPropertyAccessExpression(c) || !f || !ts.isPropertyAccessExpression(f) || f.name.text !== "id" || !ts.isIdentifier(f.expression)) return [];
      return [[c.name.text, f.expression.text] as [string, string]];
    });
  };
  /** The schema's helpers that build a key (`underProject`): their pairs, applied where they are called. */
  const helpers = new Map<string, [string, string][]>();
  /** Every key built in `node`, by `foreignKey` or a helper. */
  const keysIn = (node: ts.Node): [string, string][] => {
    const out: [string, string][] = [];
    const scan = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        if (n.expression.text === "foreignKey") out.push(...keyPairs(n));
        else out.push(...(helpers.get(n.expression.text) ?? []));
      }
      ts.forEachChild(n, scan);
    };
    scan(node);
    return out;
  };
  for (const s of sf.statements) {
    const declared: [string, ts.Node | undefined][] = ts.isFunctionDeclaration(s)
      ? [[s.name?.text ?? "", s.body]]
      : ts.isVariableStatement(s)
        ? s.declarationList.declarations.map((d) => [d.name.getText(sf), d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) ? d.initializer.body : undefined])
        : [];
    for (const [name, body] of declared) {
      const pairs = body ? keysIn(body) : [];
      if (name && pairs.length) helpers.set(name, pairs);
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const call = node.initializer;
      const callee = call.expression.getText(sf);
      const [first, second] = call.arguments;
      if (callee === "pgTable" && first && ts.isStringLiteral(first) && second && ts.isObjectLiteralExpression(second)) {
        const columns = new Map<string, { sql: string; references?: string }>();
        for (const p of second.properties) {
          if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
          let sqlName = snake(p.name.text);
          let references: string | undefined;
          const scan = (n: ts.Node) => {
            if (ts.isCallExpression(n)) {
              const [arg] = n.arguments;
              if (ts.isIdentifier(n.expression) && arg && ts.isStringLiteral(arg)) sqlName = arg.text;
              if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "references" && arg && ts.isArrowFunction(arg)) {
                const body = arg.body;
                if (ts.isPropertyAccessExpression(body) && ts.isIdentifier(body.expression)) references = body.expression.text;
              }
            }
            ts.forEachChild(n, scan);
          };
          scan(p.initializer);
          columns.set(p.name.text, { sql: sqlName, references });
        }
        // The table's extra config: its composite keys.
        const extra = call.arguments[2];
        if (extra) {
          // `(table) => ({ … foreignColumns: [table.tenantId, table.id] })`: its own parameter is the table itself.
          const self = (ts.isArrowFunction(extra) || ts.isFunctionExpression(extra)) && extra.parameters[0] ? extra.parameters[0].name.getText(sf) : undefined;
          for (const [column, table] of keysIn(extra)) {
            const col = columns.get(column);
            if (col && col.references === undefined) col.references = table === self ? node.name.text : table;
          }
        }
        raw.set(node.name.text, { sql: first.text, columns });
      }
      if (callee === "relations" && first && ts.isIdentifier(first) && second && ts.isArrowFunction(second)) {
        const objects: ts.Expression[] = [];
        const body = second.body;
        if (ts.isBlock(body)) body.statements.forEach((s) => ts.isReturnStatement(s) && s.expression && objects.push(s.expression));
        else objects.push(body);
        for (let object of objects) {
          while (ts.isParenthesizedExpression(object)) object = object.expression;
          if (!ts.isObjectLiteralExpression(object)) continue;
          for (const p of object.properties) {
            if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) || !ts.isCallExpression(p.initializer)) continue;
            const target = p.initializer.arguments[0];
            if (target && ts.isIdentifier(target)) relations.set(`${first.text}.${p.name.text}`, target.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // Under a project, to a fixed point: `projects`, a `projectId`, or a key to a table under one.
  const under = new Set<string>(["projects"]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, t] of raw) {
      if (under.has(name)) continue;
      if ([...t.columns].some(([c, col]) => c === "projectId" || (col.references !== undefined && col.references !== name && under.has(col.references)))) {
        under.add(name);
        grew = true;
      }
    }
  }
  const tables = new Map<string, Table>();
  for (const [name, t] of raw) {
    const scoping = new Set<string>();
    if (under.has(name)) scoping.add("id");
    for (const [c, col] of t.columns) if (c === "projectId" || (col.references !== undefined && under.has(col.references))) scoping.add(c);
    tables.set(name, {
      name,
      sql: t.sql,
      soft: t.columns.has("deletedAt"),
      underProject: under.has(name),
      scoping,
      scopingSql: new Set([...scoping].map((c) => t.columns.get(c)?.sql ?? snake(c))),
    });
  }
  return { tables, soft: [...tables.values()].filter((t) => t.soft).map((t) => t.name), relations };
}

// ─── Evidence ────────────────────────────────────────────────────────────────

type Evidence = {
  /** Sources (binding keys) whose deleted rows are left out. */
  rows: Set<string>;
  /** A deleted project's rows are left out. */
  live: boolean;
  /** Narrowed by value to one project's rows. */
  scoped: boolean;
  /** Left-joined sources whose on leaves out their deleted rows: rule 1 for them, nothing else (never merged). */
  joined?: Set<string>;
};

const empty = (): Evidence => ({ rows: new Set(), live: false, scoped: false });

type Site = { node: ts.Node; table: string; key: string; kind: ReadKind; root: ts.Node; alias?: string; evidence: () => Evidence };
type Source = { key: string; tables: Set<string>; method: string };

export function analyze(files: SourceFile[], schema: Schema): Report {
  const tableByName = schema.tables;
  const tableBySql = new Map([...tableByName.values()].map((t) => [t.sql, t.name]));
  const isSoft = (t: string) => tableByName.get(t)?.soft === true;
  const parsed = new Map<string, ts.SourceFile>();
  for (const f of files) parsed.set(resolve(f.path), ts.createSourceFile(f.path, f.text, ts.ScriptTarget.Latest, true, f.path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
  const reads: Read[] = [];
  const problems: Problem[] = [];
  const lineOf = (node: ts.Node) => node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

  // ── Binding keys: `T:projects` for the table itself, `D:<file>:<pos>` for an alias, a parameter, a picked table ──

  const keyTables = new Map<string, Set<string>>();
  const keyIndex = new Map<string, number>();
  const keyOfIndex: string[] = [];
  const register = (key: string, tables: Set<string>) => {
    if (!keyTables.has(key)) {
      keyTables.set(key, tables);
      keyIndex.set(key, keyOfIndex.length);
      keyOfIndex.push(key);
    }
    return { key, tables };
  };
  const indexOf = (key: string) => keyIndex.get(key)!;
  const isProjectsKey = (key: string) => keyTables.get(key)?.has("projects") === true;
  const liveOf = (ev: Evidence) => ev.live || [...ev.rows].some(isProjectsKey);

  function merge(into: Evidence, from: Evidence, own: Set<string> = new Set()) {
    for (const k of from.rows) if (!own.has(k)) into.rows.add(k);
    into.live ||= liveOf(from);
    into.scoped ||= from.scoped;
  }
  /** What both prove: a condition in one branch only proves nothing. */
  const both = (a: Evidence, b: Evidence): Evidence => ({
    rows: new Set([...a.rows].filter((k) => b.rows.has(k))),
    live: liveOf(a) && liveOf(b),
    scoped: a.scoped && b.scoped,
  });
  const all = (list: Evidence[]) => list.reduce<Evidence | undefined>((a, b) => (a ? both(a, b) : b), undefined) ?? empty();

  // ── Names: scopes and imports ──

  /** The declaration a name refers to at `at`: a local const/function/parameter, an import, or nothing. */
  function declarationOf(name: string, at: ts.Node): ts.Node | undefined {
    for (let n: ts.Node | undefined = at; n; n = n.parent) {
      if (ts.isFunctionLike(n)) {
        for (const p of n.parameters) {
          if (ts.isIdentifier(p.name) && p.name.text === name) return p;
          if (!ts.isIdentifier(p.name)) for (const e of bindingNames(p.name)) if (e.name.getText() === name) return e;
        }
      }
      if (ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isForStatement(n)) {
        const init = n.initializer;
        if (init && ts.isVariableDeclarationList(init)) for (const d of init.declarations) if (d.name.getText() === name) return d;
      }
      if (ts.isCatchClause(n) && n.variableDeclaration?.name.getText() === name) return n.variableDeclaration;
      const statements = ts.isSourceFile(n) || ts.isBlock(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n) ? n.statements : undefined;
      if (!statements) continue;
      for (const s of statements) {
        if (ts.isVariableStatement(s)) {
          for (const d of s.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === name) return d;
            if (!ts.isIdentifier(d.name)) for (const e of bindingNames(d.name)) if (e.name.getText() === name) return e;
          }
        } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name?.text === name) return s;
        else if (ts.isImportDeclaration(s) && s.importClause) {
          const bindings = s.importClause.namedBindings;
          if (s.importClause.name?.text === name) return s.importClause;
          if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) if (e.name.text === name) return e;
          if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name) return bindings;
        }
      }
    }
    return undefined;
  }

  function bindingNames(pattern: ts.BindingName): ts.BindingElement[] {
    if (ts.isIdentifier(pattern)) return [];
    return pattern.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : [e, ...bindingNames(e.name)]));
  }

  const importModule = (spec: ts.ImportSpecifier) => (spec.parent.parent.parent.moduleSpecifier as ts.StringLiteral).text;
  /** Imported from the database package (`@repo/db`), or from the schema itself within it. */
  const fromDatabase = (spec: ts.ImportSpecifier) => !importModule(spec).startsWith(".") || /\/schema$/.test(importModule(spec));

  /** The top-level declaration `name` of a scanned file, following `export … from`. */
  function exported(file: string, name: string, seen = new Set<string>()): ts.Node | undefined {
    const key = `${file}#${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const sf = parsed.get(file);
    if (!sf) return undefined;
    for (const s of sf.statements) {
      if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) return d;
      if (ts.isFunctionDeclaration(s) && s.name?.text === name) return s;
      if (ts.isExportDeclaration(s) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) {
        const target = moduleFile(file, s.moduleSpecifier.text);
        if (!target) continue;
        const clause = s.exportClause;
        if (!clause) {
          const found = exported(target, name, seen);
          if (found) return found;
        } else if (ts.isNamedExports(clause)) {
          for (const e of clause.elements) if (e.name.text === name) return exported(target, (e.propertyName ?? e.name).text, seen);
        }
      }
    }
    return undefined;
  }

  function moduleFile(from: string, spec: string): string | undefined {
    if (!spec.startsWith(".")) return undefined;
    const base = resolve(dirname(from), spec);
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (parsed.has(c)) return c;
    return undefined;
  }

  /** The declaration behind a name, through an import from a scanned file. */
  function target(decl: ts.Node | undefined): ts.Node | undefined {
    if (!decl || !ts.isImportSpecifier(decl)) return decl;
    const file = moduleFile(resolve(decl.getSourceFile().fileName), importModule(decl));
    return file ? exported(file, (decl.propertyName ?? decl.name).text) : undefined;
  }

  const isConst = (d: ts.VariableDeclaration) => ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const) !== 0;

  const reassignedMemo = new Map<ts.Node, boolean>();
  /** A `let`/`var` written again after its declaration. */
  function reassigned(decl: ts.VariableDeclaration): boolean {
    if (isConst(decl) || !ts.isIdentifier(decl.name)) return false;
    const memo = reassignedMemo.get(decl);
    if (memo !== undefined) return memo;
    const name = decl.name.text;
    let found = false;
    const visit = (n: ts.Node) => {
      const assigned =
        (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && n.left) ||
        ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && n.operand);
      if (assigned && ts.isIdentifier(assigned) && assigned.text === name && declarationOf(name, assigned) === decl) found = true;
      if (!found) ts.forEachChild(n, visit);
    };
    visit(decl.getSourceFile());
    reassignedMemo.set(decl, found);
    return found;
  }

  function unwrap(expr: ts.Expression): ts.Expression {
    while (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isTypeAssertionExpression(expr)) expr = expr.expression;
    return expr;
  }

  const isSqlTemplate = (n: ts.Node | undefined): n is ts.TaggedTemplateExpression =>
    !!n && ts.isTaggedTemplateExpression(n) && ts.isIdentifier(n.tag) && n.tag.text === "sql";

  /** A relational `where: (t, ops) => …`: its first parameter is the query's own source. */
  const relationalParam = new Map<ts.Node, { key: string; tables: Set<string> }>();

  /** The table(s) an expression is, as a source: its binding key and the schema tables it may be. */
  function binding(expr: ts.Expression, depth = 0): { key: string; tables: Set<string> } | undefined {
    expr = unwrap(expr);
    if (depth > 8) return undefined;
    const at = `${resolve(expr.getSourceFile().fileName)}:${expr.getStart()}`;
    if (ts.isConditionalExpression(expr)) {
      const tables = new Set([...(binding(expr.whenTrue, depth + 1)?.tables ?? []), ...(binding(expr.whenFalse, depth + 1)?.tables ?? [])]);
      return tables.size ? register(`D:${at}`, tables) : undefined;
    }
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "alias" && expr.arguments[0]) {
      const of = binding(expr.arguments[0], depth + 1);
      return of ? register(`D:${at}`, of.tables) : undefined;
    }
    // `schema.projects` of `import * as schema from "./schema"`.
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && tableByName.has(expr.name.text)) {
      const ns = declarationOf(expr.expression.text, expr.expression);
      return ns && ts.isNamespaceImport(ns) ? register(`T:${expr.name.text}`, new Set([expr.name.text])) : undefined;
    }
    if (!ts.isIdentifier(expr)) return undefined;
    const decl = declarationOf(expr.text, expr);
    if (!decl) return tableByName.has(expr.text) ? register(`T:${expr.text}`, new Set([expr.text])) : undefined;
    const relational = relationalParam.get(decl);
    if (relational) return relational;
    if (ts.isImportSpecifier(decl)) {
      const original = (decl.propertyName ?? decl.name).text;
      return tableByName.has(original) && fromDatabase(decl) ? register(`T:${original}`, new Set([original])) : undefined;
    }
    const declAt = `${resolve(decl.getSourceFile().fileName)}:${decl.getStart()}`;
    if (ts.isParameter(decl) && decl.type) {
      const tables = new Set([...decl.type.getText().matchAll(/typeof\s+(\w+)/g)].map((m) => m[1]!).filter((t) => tableByName.has(t)));
      return tables.size ? register(`D:${declAt}`, tables) : undefined;
    }
    if (ts.isVariableDeclaration(decl) && decl.initializer && !reassigned(decl)) {
      const init = unwrap(decl.initializer);
      // `const t = projects`: the same source; an alias or a pick: a source of its own.
      if (ts.isIdentifier(init) || ts.isPropertyAccessExpression(init)) return binding(init, depth + 1);
      const of = binding(init, depth + 1);
      return of ? register(`D:${declAt}`, of.tables) : undefined;
    }
    return undefined;
  }

  /** `t.column` on a source: its key, tables and column; `isColumn` also for a subquery's field (`sub.x`). */
  function columnOf(expr: ts.Expression): { key?: string; tables: Set<string>; column: string; isColumn: boolean } | undefined {
    expr = unwrap(expr);
    if (!ts.isPropertyAccessExpression(expr)) return undefined;
    const object = unwrap(expr.expression);
    const b = binding(object);
    if (b) return { key: b.key, tables: b.tables, column: expr.name.text, isColumn: true };
    if (ts.isIdentifier(object)) {
      const decl = declarationOf(object.text, object);
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
        const init = unwrap(decl.initializer);
        if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === "as") {
          return { tables: new Set(), column: expr.name.text, isColumn: true };
        }
      }
    }
    return { tables: new Set(), column: expr.name.text, isColumn: false };
  }

  /** A value the caller holds: an identifier, a literal, a property or element of one, an array of them, a method on one. */
  function isValue(expr: ts.Expression): boolean {
    expr = unwrap(expr);
    if (ts.isStringLiteral(expr) || ts.isNumericLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return true;
    if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword || expr.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isTemplateExpression(expr)) return expr.templateSpans.every((s) => isValue(s.expression));
    if (ts.isAwaitExpression(expr)) return true;
    if (ts.isIdentifier(expr)) {
      if (binding(expr)) return false;
      // What a const was given; a parameter, a destructured result, a loop variable, an import: a value.
      const decl = declarationOf(expr.text, expr);
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer && ts.isIdentifier(decl.name)) {
        if (valueMemo2.has(decl)) return valueMemo2.get(decl)!;
        valueMemo2.set(decl, false);
        const value = isValue(decl.initializer);
        valueMemo2.set(decl, value);
        return value;
      }
      return true;
    }
    if (ts.isPropertyAccessExpression(expr)) return !columnOf(expr)!.isColumn && isValue(expr.expression);
    if (ts.isElementAccessExpression(expr)) return isValue(expr.expression);
    if (ts.isArrayLiteralExpression(expr)) return expr.elements.every((e) => isValue(ts.isSpreadElement(e) ? e.expression : e));
    if (ts.isConditionalExpression(expr)) return isValue(expr.whenTrue) && isValue(expr.whenFalse);
    if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.PlusToken].includes(expr.operatorToken.kind)) {
      return isValue(expr.left) && isValue(expr.right);
    }
    if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
      return ["map", "filter", "flatMap", "slice", "concat", "flat", "toString", "trim", "toLowerCase", "toUpperCase"].includes(expr.expression.name.text) && isValue(expr.expression.expression);
    }
    // A local helper whose every return is a value (`payerOf(invoice)`), never one that builds a query.
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
      const decl = target(declarationOf(expr.expression.text, expr.expression));
      const fn = decl && ts.isVariableDeclaration(decl) && decl.initializer ? unwrap(decl.initializer) : decl;
      if (!fn || !(ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return false;
      if (valueMemo2.has(fn)) return valueMemo2.get(fn)!;
      valueMemo2.set(fn, false);
      const returns = returnsOf(fn);
      const value = returns.length > 0 && returns.every((r) => r.pos >= 0 && isValue(r));
      valueMemo2.set(fn, value);
      return value;
    }
    return false;
  }

  const valueMemo2 = new Map<ts.Node, boolean>();

  // ── Query chains ──

  /** Every builder chain that reads a table of the schema, by its top node, with its sources. */
  const chains = new Map<ts.Node, Source[]>();
  const sites: Site[] = [];
  const sitesByRoot = new Map<ts.Node, Site[]>();

  /** The top of a builder chain: `db.select().from(t).where(…).limit(1)`. */
  function chainRoot(node: ts.Node): ts.Node {
    let n = node;
    while (n.parent && ((ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n) || (ts.isCallExpression(n.parent) && n.parent.expression === n))) n = n.parent;
    return n;
  }

  function addSite(site: Site) {
    sites.push(site);
    const list = sitesByRoot.get(site.root) ?? [];
    list.push(site);
    sitesByRoot.set(site.root, list);
  }

  function addSource(root: ts.Node, source: Source) {
    const list = chains.get(root) ?? [];
    list.push(source);
    chains.set(root, list);
  }

  // ── Evidence ──

  const helperMemo = new Map<ts.Node, Evidence | "busy">();
  const valueMemo = new Map<ts.Node, Evidence | "busy">();
  const chainMemo = new Map<ts.Node, Evidence>();

  /** The returns of a function (not of the functions inside it). */
  function returnsOf(fn: ts.SignatureDeclaration): ts.Expression[] {
    const body = (fn as ts.FunctionLikeDeclaration).body;
    if (!body) return [];
    if (!ts.isBlock(body)) return [body];
    const out: ts.Expression[] = [];
    let bare = false;
    const visit = (n: ts.Node) => {
      if (ts.isReturnStatement(n)) {
        if (n.expression) out.push(n.expression);
        else bare = true;
      }
      if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
    };
    visit(body);
    return bare ? [...out, ts.factory.createIdentifier("undefined")] : out;
  }

  /** What a call of a helper proves: every one of its returns must. */
  function helperEvidence(decl: ts.Node): Evidence {
    const memo = helperMemo.get(decl);
    if (memo === "busy") return empty();
    if (memo) return memo;
    helperMemo.set(decl, "busy");
    let fn: ts.Node | undefined = decl;
    if (ts.isVariableDeclaration(decl)) fn = decl.initializer && isConst(decl) ? unwrap(decl.initializer) : undefined;
    let ev = empty();
    if (fn && (ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
      ev = all(
        returnsOf(fn).map((r) => {
          const e = empty();
          // A synthesised `undefined` (a bare `return`) has no place in a file: it proves nothing.
          if (r.pos >= 0) collect(r, e, false);
          return e;
        }),
      );
    }
    helperMemo.set(decl, ev);
    return ev;
  }

  /** What a variable holds: its initializer and the `.push(…)`es at its own level; nothing if it is written again. */
  function valueEvidence(decl: ts.Node): Evidence {
    const memo = valueMemo.get(decl);
    if (memo === "busy") return empty();
    if (memo) return memo;
    valueMemo.set(decl, "busy");
    const ev = empty();
    if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name) && decl.initializer && !reassigned(decl)) {
      const init = unwrap(decl.initializer);
      if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) {
        collect(init, ev, false);
        const name = decl.name.text;
        const block = decl.parent.parent.parent;
        const statements = block && (ts.isBlock(block) || ts.isSourceFile(block)) ? block.statements : [];
        for (const s of statements) {
          if (!ts.isExpressionStatement(s)) continue;
          const call = s.expression;
          if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "push") {
            const receiver = call.expression.expression;
            if (ts.isIdentifier(receiver) && receiver.text === name && declarationOf(name, receiver) === decl) for (const a of call.arguments) collect(a, ev, false);
          }
        }
      }
    }
    valueMemo.set(decl, ev);
    return ev;
  }

  /** Collects into `ev` what `node` proves as a condition. `weak`: under a negation or a choice, nothing counts. */
  function collect(node: ts.Node, ev: Evidence, weak: boolean, visiting = new Set<ts.Node>()) {
    if (visiting.has(node)) return;
    visiting.add(node);
    const nested = chains.get(node);
    if (nested && ts.isExpression(node)) {
      // A subquery: what it proves about other sources counts here (`projects` above all), not about its own.
      if (!weak) merge(ev, chainEvidence(node), new Set(nested.map((s) => s.key)));
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      const [a, b] = node.arguments;
      if (!weak && name === "isNull" && a) {
        const col = columnOf(a);
        if (col?.key && col.column === "deletedAt") ev.rows.add(col.key);
      }
      if (!weak && (name === "eq" || name === "inArray") && a && b) {
        if (narrows(a, b) || (name === "eq" && narrows(b, a))) ev.scoped = true;
      }
      if (name === "or" && ts.isIdentifier(callee)) {
        // Rows pass `or(a, b)` through a or through b: only what both prove holds for them all.
        if (!weak) merge(ev, all(node.arguments.map((arg) => { const e = empty(); collect(arg, e, false, new Set(visiting)); return e; })));
        return;
      }
      const isWeak = weak || WEAK.has(name);
      if (!isWeak && ts.isIdentifier(callee)) {
        const t = target(declarationOf(callee.text, callee));
        if (t && !ts.isImportSpecifier(t)) merge(ev, helperEvidence(t));
      }
      for (const arg of node.arguments) collect(arg, ev, isWeak, visiting);
      if (ts.isPropertyAccessExpression(callee)) collect(callee.expression, ev, isWeak, visiting);
      return;
    }
    if (isSqlTemplate(node)) {
      const t = templateInfo(node);
      if (!weak) merge(ev, t.condition, t.own);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      const yes = empty();
      const no = empty();
      collect(node.whenTrue, yes, weak, new Set(visiting));
      collect(node.whenFalse, no, weak, new Set(visiting));
      merge(ev, both(yes, no));
      return;
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
      collect(node.left, ev, true, visiting);
      collect(node.right, ev, true, visiting);
      return;
    }
    if (ts.isIdentifier(node)) {
      const t = target(declarationOf(node.text, node));
      if (!weak && t && ts.isVariableDeclaration(t)) merge(ev, valueEvidence(t));
      return;
    }
    if (ts.isFunctionLike(node) && !ts.isArrowFunction(node)) return;
    ts.forEachChild(node, (child) => collect(child, ev, weak, visiting));
  }

  /** `col` against `value`: a column that narrows its table to one project's rows, given a value. */
  function narrows(colExpr: ts.Expression, valueExpr: ts.Expression): boolean {
    const col = columnOf(colExpr);
    if (!col?.isColumn || !isValue(valueExpr)) return false;
    return [...col.tables].some((t) => tableByName.get(t)?.scoping.has(col.column));
  }

  /** What a chain's conditions prove (memoised; cycles prove nothing). */
  function chainEvidence(root: ts.Node): Evidence {
    const memo = chainMemo.get(root);
    if (memo) return memo;
    const ev = empty();
    chainMemo.set(root, ev);
    const visitChain = (n: ts.Node) => {
      if (!ts.isCallExpression(n)) {
        if (ts.isPropertyAccessExpression(n)) visitChain(n.expression);
        return;
      }
      const callee = n.expression;
      if (!ts.isPropertyAccessExpression(callee)) return visitChain(callee);
      const method = callee.name.text;
      const [first, second] = n.arguments;
      if (method === "where" || method === "having") for (const a of n.arguments) collect(a, ev, false);
      else if ((method === "innerJoin" || method === "$count") && second) collect(second, ev, false);
      else if (method === "leftJoin" && first && second) {
        // A left join's on only says which of its own rows join: nothing about the rest of the query.
        const own = binding(first);
        const on = empty();
        collect(second, on, false);
        if (own && on.rows.has(own.key)) (ev.joined ??= new Set()).add(own.key);
      } else if ((method === "findFirst" || method === "findMany") && first) {
        const where = property(objectOf(first), "where");
        if (where) collect(where, ev, false);
      }
      visitChain(callee.expression);
    };
    visitChain(root);
    // A builder kept in a const (`$dynamic()` or not) or returned by a local arrow: what every use of it adds.
    merge(ev, usesEvidence(root));
    return ev;
  }

  function usesEvidence(root: ts.Node): Evidence {
    let holder: ts.Node = root;
    while (holder.parent && (ts.isParenthesizedExpression(holder.parent) || ts.isAsExpression(holder.parent))) holder = holder.parent;
    const viaArrow = holder.parent && ts.isArrowFunction(holder.parent) && holder.parent.body === holder;
    const decl = viaArrow ? holder.parent.parent : holder.parent;
    if (!decl || !ts.isVariableDeclaration(decl) || decl.initializer === undefined || !ts.isIdentifier(decl.name) || !isConst(decl)) return empty();
    const name = decl.name.text;
    const uses: ts.Node[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n) && n.text === name && n !== decl.name && declarationOf(name, n) === decl) uses.push(n);
      ts.forEachChild(n, visit);
    };
    visit(decl.getSourceFile());
    if (uses.length === 0) return empty();
    return all(
      uses.map((use) => {
        // `rows().where(…)` / `qb.where(…)`: the chain it starts. Any other use (passed on, returned bare): nothing.
        const start = viaArrow ? use.parent : use;
        if (viaArrow && !(ts.isCallExpression(start) && start.expression === use)) return empty();
        if (!(ts.isPropertyAccessExpression(start.parent) && start.parent.expression === start)) return empty();
        return chainEvidence(chainRoot(start));
      }),
    );
  }

  // ── Objects (relational options, `with`) ──

  type Props = { props: Map<string, ts.Expression>; readable: boolean };
  /** An object literal's properties, through consts, spreads and local functions; `readable` false if any part isn't. */
  function objectOf(expr: ts.Expression | undefined, depth = 0): Props {
    const out: Props = { props: new Map(), readable: true };
    if (!expr || depth > 6) return { props: out.props, readable: false };
    expr = unwrap(expr);
    if (ts.isObjectLiteralExpression(expr)) {
      for (const p of expr.properties) {
        if (ts.isPropertyAssignment(p)) out.props.set(p.name.getText(), p.initializer);
        else if (ts.isShorthandPropertyAssignment(p)) out.props.set(p.name.text, p.name);
        else if (ts.isSpreadAssignment(p)) {
          const inner = objectOf(p.expression, depth + 1);
          for (const [k, v] of inner.props) out.props.set(k, v);
          out.readable &&= inner.readable;
        } else out.readable = false;
      }
      return out;
    }
    const name = ts.isIdentifier(expr) ? expr : ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) ? expr.expression : undefined;
    const decl = name && target(declarationOf(name.text, name));
    if (!decl) return { props: out.props, readable: false };
    let init: ts.Node | undefined = ts.isVariableDeclaration(decl) && isConst(decl) ? decl.initializer : ts.isFunctionDeclaration(decl) ? decl : undefined;
    if (init && ts.isCallExpression(expr)) {
      init = unwrap(init as ts.Expression);
      const fn = init as ts.Node;
      const returns = ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn) ? returnsOf(fn) : [];
      init = returns.length === 1 ? returns[0] : undefined;
    } else if (ts.isCallExpression(expr)) init = undefined;
    return init && ts.isExpression(init) ? objectOf(init, depth + 1) : { props: out.props, readable: false };
  }

  const property = (o: Props, name: string) => o.props.get(name);

  // ── Raw SQL ──

  type Ref = { tables: Set<string>; key?: string; alias?: string; at: number; level: Group };
  type Group = { start: number; end: number; parent?: Group; subquery: boolean };
  type TemplateInfo = {
    /** What it proves used as a condition (its own sources aside). */
    condition: Evidence;
    own: Set<string>;
    occurrences: (Ref & { table: string; rows: boolean; live: boolean; scoped: boolean })[];
  };
  const templateMemo = new Map<ts.Node, TemplateInfo>();
  const textMemo = new Map<ts.Node, string>();

  /**
   * The template's text, lower case, quotes blanked, spans as placeholders: `__tN__` a table (binding N), `__cN_col__`
   * its column, `__v__` a value, `__x__` anything else, and `__rowsN__` / `__live__` / `__scoped__` where a helper
   * proves it. A fragment written straight in a span, or kept in a const, is written in place; any other is read alone.
   */
  function templateText(node: ts.TaggedTemplateExpression, depth = 0): string {
    const memo = textMemo.get(node);
    if (memo !== undefined) return memo;
    const span = (raw: ts.Expression): string => {
      const expr = unwrap(raw);
      const b = binding(expr);
      if (b && !ts.isPropertyAccessExpression(expr)) return ` __t${indexOf(b.key)}__ `;
      let fragment: ts.Node | undefined = expr;
      if (ts.isIdentifier(expr)) {
        const decl = target(declarationOf(expr.text, expr));
        fragment = decl && ts.isVariableDeclaration(decl) && isConst(decl) && decl.initializer ? unwrap(decl.initializer) : undefined;
      }
      if (isSqlTemplate(fragment) && depth < 6) return ` ${templateText(fragment, depth + 1)} `;
      const col = columnOf(expr);
      if (col?.isColumn) return col.key ? ` __c${indexOf(col.key)}_${col.column.toLowerCase()}__ ` : " __x__ ";
      const proven = empty();
      collect(expr, proven, false);
      const tokens = [...proven.rows].map((k) => `__rows${indexOf(k)}__`);
      if (liveOf(proven)) tokens.push("__live__");
      if (proven.scoped) tokens.push("__scoped__");
      return ` ${isValue(expr) ? "__v__" : "__x__"} ${tokens.join(" ")} `;
    };
    const template = node.template;
    let text = ts.isNoSubstitutionTemplateLiteral(template) ? template.text : template.head.text;
    if (ts.isTemplateExpression(template)) for (const s of template.templateSpans) text += span(s.expression) + s.literal.text;
    text = text.toLowerCase().replace(/'(?:[^']|'')*'/g, (m) => " ".repeat(m.length));
    textMemo.set(node, text);
    return text;
  }

  function groupsOf(text: string): { groups: Group[]; root: Group } {
    const root: Group = { start: -1, end: text.length, subquery: true };
    const groups: Group[] = [];
    const stack: Group[] = [root];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "(") {
        const g: Group = { start: i, end: text.length, parent: stack.at(-1), subquery: /^\(\s*(?:select|with)\b/.test(text.slice(i, i + 20)) };
        groups.push(g);
        stack.push(g);
      } else if (text[i] === ")" && stack.length > 1) stack.pop()!.end = i;
    }
    return { groups, root };
  }

  function templateInfo(node: ts.TaggedTemplateExpression): TemplateInfo {
    const memo = templateMemo.get(node);
    if (memo) return memo;
    const text = templateText(node);
    const { groups, root } = groupsOf(text);
    const groupAt = (pos: number) => {
      let best = root;
      for (const g of groups) if (g.start < pos && pos < g.end && g.start > best.start) best = g;
      return best;
    };
    const levelOf = (g: Group) => {
      let l = g;
      while (!l.subquery) l = l.parent!;
      return l;
    };
    /** `g`'s text with the groups inside it blanked. */
    const flat = (g: Group) => {
      let out = "";
      let depth = 0;
      for (let i = g.start + 1; i < g.end; i++) {
        const c = text[i]!;
        if (c === "(") depth++;
        out += depth > 0 ? " " : c;
        if (c === ")") depth--;
      }
      return out;
    };
    const negated = (g: Group) => /\bnot\s*$/.test(text.slice(Math.max(0, g.start - 8), Math.max(0, g.start)));
    const CLAUSE = /\b(select|from|where|join|on|group\s+by|order\s+by|having|limit|returning|set|union|values|with)\b/g;
    /** A condition at `pos` holds for its select's rows: in a where / on / having, under no `or` or `not`. */
    const strong = (pos: number, level: Group): boolean => {
      let g = groupAt(pos);
      let top = pos;
      while (g !== level) {
        if (/\bor\b/.test(flat(g)) || negated(g)) return false;
        top = g.start;
        g = g.parent!;
      }
      const body = flat(level);
      const offset = level.start + 1;
      const at = top - offset;
      let clause: string | undefined;
      let from = 0;
      let to = body.length;
      for (const m of body.matchAll(CLAUSE)) {
        if (m.index! < at) {
          clause = m[1];
          from = m.index!;
        } else {
          to = m.index!;
          break;
        }
      }
      // A fragment with no clause (a condition in a builder's where) stands alone.
      if (clause === undefined && level !== root) return false;
      if (clause !== undefined && !["where", "on", "having"].includes(clause)) return false;
      const segment = body.slice(from, to);
      if (/\bor\b/.test(segment)) return false;
      return !/(?<!\bis\s)\bnot\s*$/.test(body.slice(from, at));
    };

    // Tables named: after from / join / update, comma lists, schema-qualified, `${t}`.
    const refs: Ref[] = [];
    const ITEM = /^\s*(?:only\s+)?(?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?(?:__t(\d+)__|"([a-z_][a-z0-9_]*)"|([a-z_][a-z0-9_]*))/;
    const ALIAS = /^\s*(?:as\s+)?([a-z_][a-z0-9_]*)/;
    for (const m of text.matchAll(/\b(from|join|update)\s+/g)) {
      let at = m.index! + m[0].length;
      for (;;) {
        const item = ITEM.exec(text.slice(at));
        if (!item) break;
        const pos = at;
        at += item[0].length;
        let tables = new Set<string>();
        let key: string | undefined;
        if (item[1]) {
          key = keyOfIndex[Number(item[1])]!;
          tables = keyTables.get(key)!;
        } else {
          const name = tableBySql.get((item[2] ?? item[3])!);
          if (name) {
            key = register(`T:${name}`, new Set([name])).key;
            tables = new Set([name]);
          }
        }
        const a = ALIAS.exec(text.slice(at));
        const alias = a && !SQL_ALIAS_STOP.has(a[1]!) && !a[1]!.startsWith("__") ? a[1] : undefined;
        if (alias) at += a![0].length;
        if (tables.size) refs.push({ tables, key, alias, at: pos, level: levelOf(groupAt(pos)) });
        if (m[1] !== "from" || !/^\s*,/.test(text.slice(at))) break;
        at += /^\s*,/.exec(text.slice(at))![0].length;
      }
    }

    const matchesAt = (re: RegExp, level: Group) => [...text.matchAll(re)].some((m) => levelOf(groupAt(m.index!)) === level && strong(m.index!, level));
    const filtered = (r: Ref) => {
      const sqlNames = [...r.tables].map((t) => tableByName.get(t)!.sql);
      const qualifier = r.alias ? r.alias : `(?:${sqlNames.map((n) => `"?${n}"?`).join("|")})`;
      const patterns = [String.raw`(?<![\w.])${qualifier}\s*\.\s*"?deleted_at"?\s+is\s+null`];
      if (!r.alias) patterns.push(String.raw`(?<![\w."])"?deleted_at"?\s+is\s+null`);
      if (r.key) patterns.push(`__rows${indexOf(r.key)}__`, String.raw`__c${indexOf(r.key)}_deletedat__\s+is\s+null`);
      return patterns.some((p) => matchesAt(new RegExp(p, "g"), r.level));
    };

    // Rule 2, per select: its own conditions, a subquery in them, the CTE it reads, or the select it is nested in.
    const ctes = new Map<string, Group>();
    for (const m of text.matchAll(/(?:\bwith\s+(?:recursive\s+)?|,\s*)([a-z_][a-z0-9_]*)\s+as\s*\(/g)) {
      const g = groupAt(m.index! + m[0].length);
      if (g.subquery) ctes.set(m[1]!, g);
    }
    const levelMemo = new Map<Group, { live: boolean; scoped: boolean } | "busy">();
    /** What a select's own conditions prove: their text, a subquery in them, the CTEs it reads. */
    const ownEvidence = (level: Group): { live: boolean; scoped: boolean } => {
      const memo = levelMemo.get(level);
      if (memo === "busy") return { live: false, scoped: false };
      if (memo) return memo;
      levelMemo.set(level, "busy");
      let live = refs.some((r) => r.level === level && r.tables.has("projects") && filtered(r)) || matchesAt(/__live__/g, level);
      let scoped = matchesAt(/__scoped__/g, level);
      // `x.col = ${value}` where `col` narrows x's table (by its alias at this select, or its name), or `${t.col} = …`.
      const VALUE = String.raw`\s*(?:=|in\b|=\s*any\b)\s*\(?\s*__v__`;
      for (const r of refs.filter((r) => r.level === level)) {
        const cols = [...r.tables].flatMap((t) => [...tableByName.get(t)!.scopingSql]);
        if (cols.length === 0) continue;
        const qualifier = r.alias ?? [...r.tables].map((t) => tableByName.get(t)!.sql).join("|");
        scoped ||= matchesAt(new RegExp(String.raw`(?<![\w.])(?:(?:${qualifier})\s*\.\s*)?(?:${cols.join("|")})` + VALUE, "g"), level);
      }
      for (const m of text.matchAll(/__c(\d+)_([a-z0-9_]+)__\s*(?:=|in\b|=\s*any\b)\s*\(?\s*__v__/g)) {
        const tables = keyTables.get(keyOfIndex[Number(m[1])]!)!;
        if ([...tables].some((t) => [...tableByName.get(t)!.scoping].some((c) => c.toLowerCase() === m[2])) && levelOf(groupAt(m.index!)) === level && strong(m.index!, level)) scoped = true;
      }
      // A subquery in this select's conditions.
      for (const g of groups) {
        if (!g.subquery || g === level || levelOf(g.parent!) !== level || negated(g) || !strong(g.start, level)) continue;
        const inner = ownEvidence(g);
        live ||= inner.live;
        scoped ||= inner.scoped;
      }
      // The CTEs it reads.
      for (const m of flat(level).matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/g)) {
        const cte = ctes.get(m[1]!);
        if (cte && cte !== level) {
          const inner = ownEvidence(cte);
          live ||= inner.live;
          scoped ||= inner.scoped;
        }
      }
      const result = { live, scoped };
      levelMemo.set(level, result);
      return result;
    };
    /** And what the selects it is nested in prove (a subquery of a checked select reads under its check). */
    const levelEvidence = (level: Group): { live: boolean; scoped: boolean } => {
      const own = ownEvidence(level);
      if (!level.parent) return own;
      const outer = levelEvidence(levelOf(level.parent));
      return { live: own.live || outer.live, scoped: own.scoped || outer.scoped };
    };

    const occurrences = refs.flatMap((r) =>
      [...r.tables].filter(isSoft).map((table) => {
        const ev = levelEvidence(r.level);
        return { ...r, table, rows: filtered(r), live: ev.live, scoped: ev.scoped };
      }),
    );
    // Used as a condition: what holds at its top level.
    const condition = empty();
    for (const m of text.matchAll(/__rows(\d+)__|__c(\d+)_deletedat__\s+is\s+null/g)) {
      if (levelOf(groupAt(m.index!)) === root && strong(m.index!, root)) condition.rows.add(keyOfIndex[Number(m[1] ?? m[2])]!);
    }
    const top = ownEvidence(root);
    condition.live = top.live;
    condition.scoped = top.scoped;
    const info: TemplateInfo = { condition, own: new Set(refs.flatMap((r) => (r.key ? [r.key] : []))), occurrences };
    templateMemo.set(node, info);
    return info;
  }

  /** Read alone: not written straight in another template's span, nor held in a const another template inlines. */
  function standalone(node: ts.TaggedTemplateExpression): boolean {
    let n: ts.Node = node;
    while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent))) n = n.parent;
    return !(n.parent && ts.isTemplateSpan(n.parent) && isSqlTemplate(n.parent.parent.parent));
  }

  // ── Discovery: chains and relational queries first, then raw SQL (a template may hold a chain) ──

  for (const sf of parsed.values()) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const kind = Object.hasOwn(QUERY_METHODS, method) ? QUERY_METHODS[method] : undefined;
        const [first] = node.arguments;
        const b = kind && first ? binding(first) : undefined;
        if (kind && b) {
          const root = chainRoot(node);
          addSource(root, { ...b, method });
          for (const table of b.tables) {
            if (!isSoft(table)) continue;
            addSite({ node, table, key: b.key, kind, root, evidence: () => chainEvidence(root) });
          }
        }
        // db.query.t.findFirst / findMany
        const receiver = node.expression.expression;
        if (
          (method === "findFirst" || method === "findMany") &&
          ts.isPropertyAccessExpression(receiver) &&
          ts.isPropertyAccessExpression(receiver.expression) &&
          receiver.expression.name.text === "query" &&
          tableByName.has(receiver.name.text)
        ) {
          const table = receiver.name.text;
          const root = chainRoot(node);
          const own = register(`T:${table}`, new Set([table]));
          addSource(root, { ...own, method });
          const options = objectOf(node.arguments[0]);
          const where = property(options, "where");
          if (where && ts.isArrowFunction(where) && where.parameters[0]) relationalParam.set(where.parameters[0], own);
          if (isSoft(table)) addSite({ node, table, key: own.key, kind: "query", root, evidence: () => chainEvidence(root) });
          if (node.arguments[0] && !options.readable) problems.push({ file: sf.fileName, line: lineOf(node), message: `query of ${table} with options that can't be read` });
          withSites(options, table, root, sf);
        }
        // `sql.raw('… project_documents …')`: text no check can read.
        if (method === "raw" && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "sql" && first) {
          const literal = ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) ? first.text : ts.isTemplateExpression(first) ? [first.head.text, ...first.templateSpans.map((s) => s.literal.text)].join(" ") : "";
          for (const t of schema.soft) {
            if (new RegExp(`\\b${tableByName.get(t)!.sql}\\b`, "i").test(literal)) {
              const key = register(`T:${t}`, new Set([t])).key;
              addSite({ node, table: t, key, kind: "raw", root: node, evidence: empty });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  for (const sf of parsed.values()) {
    const visit = (node: ts.Node) => {
      if (isSqlTemplate(node) && standalone(node)) {
        // Each place the template names a soft-deleted table is a read, decided at its own select.
        const info = templateInfo(node);
        for (const o of info.occurrences) {
          addSite({
            node,
            table: o.table,
            key: o.key ?? `T:${o.table}`,
            kind: "sql",
            root: node,
            alias: o.alias,
            evidence: () => ({ rows: new Set(o.rows ? [o.key ?? `T:${o.table}`] : []), live: o.live, scoped: o.scoped }),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  /** `with: { documents: true | { where } }`: a relation that reaches a soft-deleted table is read under its parent. */
  function withSites(options: Props, from: string, root: ts.Node, sf: ts.SourceFile) {
    const w = property(options, "with");
    if (!w) return;
    const relations = objectOf(w);
    if (!relations.readable) problems.push({ file: sf.fileName, line: lineOf(w), message: `with on ${from} that can't be read` });
    for (const [name, value] of relations.props) {
      const target = schema.relations.get(`${from}.${name}`);
      if (!target) continue;
      const v = unwrap(value);
      const isTrue = v.kind === ts.SyntaxKind.TrueKeyword;
      const spec = isTrue ? { props: new Map<string, ts.Expression>(), readable: true } : objectOf(v);
      if (!spec.readable) problems.push({ file: sf.fileName, line: lineOf(value), message: `with ${name} on ${from} that can't be read` });
      if (isSoft(target)) {
        const own = register(`W:${resolve(sf.fileName)}:${value.getStart()}`, new Set([target]));
        const where = property(spec, "where");
        if (where && ts.isArrowFunction(where) && where.parameters[0]) relationalParam.set(where.parameters[0], own);
        addSite({
          node: value,
          table: target,
          key: own.key,
          kind: "with",
          root,
          evidence: () => {
            const ev = empty();
            if (where) {
              const e = empty();
              collect(where, e, false);
              // The relation's where is written on the target table: its rows are this source's.
              if (e.rows.has(own.key) || e.rows.has(`T:${target}`)) ev.rows.add(own.key);
            }
            // Reached through its parent's relation: narrowed to that parent.
            ev.scoped = true;
            return ev;
          },
        });
      }
      withSites(spec, target, root, sf);
    }
  }

  // ── Markers ──

  type Marker = { file: string; pos: number; end: number; line: number; reason: string; tables: string[]; named: boolean; used: Set<string>; read: Set<string> };
  const markers: Marker[] = [];
  for (const sf of parsed.values()) {
    const seen = new Set<number>();
    const visit = (node: ts.Node) => {
      for (const r of ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? []) {
        if (seen.has(r.pos)) continue;
        seen.add(r.pos);
        const m = MARKER.exec(sf.text.slice(r.pos, r.end));
        if (!m) continue;
        const tables = (m[1] ?? "").split(",").map((t) => t.trim()).filter(Boolean);
        const line = sf.getLineAndCharacterOfPosition(r.pos).line + 1;
        markers.push({ file: sf.fileName, pos: r.pos, end: r.end, line, reason: m[2]!.replace(/\*\/\s*$/, "").trim(), tables, named: m[1] !== undefined, used: new Set(), read: new Set() });
      }
      for (const child of node.getChildren(sf)) visit(child);
    };
    visit(sf);
  }

  /** The node a query's marker may sit before: the query, widened over what only wraps it (await, const x =, return…). */
  function markerScope(root: ts.Node): ts.Node {
    let n = root;
    for (;;) {
      const p = n.parent;
      if (!p) return n;
      const wraps =
        ts.isAwaitExpression(p) ||
        // `db.execute(sql`…`)`: the statement that runs it.
        (ts.isCallExpression(p) && p.arguments.includes(n as ts.Expression) && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === "execute") ||
        (ts.isCallExpression(p) && p.expression === n) ||
        (ts.isPropertyAccessExpression(p) && p.expression === n) ||
        ts.isParenthesizedExpression(p) ||
        ts.isAsExpression(p) ||
        ts.isNonNullExpression(p) ||
        ts.isSatisfiesExpression(p) ||
        (ts.isElementAccessExpression(p) && p.expression === n) ||
        (ts.isVariableDeclaration(p) && p.initializer === n) ||
        (ts.isVariableDeclarationList(p) && p.declarations.length === 1) ||
        ts.isVariableStatement(p) ||
        ts.isExpressionStatement(p) ||
        ts.isReturnStatement(p) ||
        (ts.isPropertyAssignment(p) && p.initializer === n) ||
        (ts.isArrowFunction(p) && p.body === n) ||
        (ts.isConditionalExpression(p) && p.condition !== n) ||
        (ts.isBinaryExpression(p) && p.right === n);
      if (!wraps) return n;
      n = p;
    }
  }

  // ── Verdicts ──

  for (const site of sites) {
    const sf = site.node.getSourceFile();
    const ev = site.evidence();
    const rows = site.kind !== "delete" && site.kind !== "raw" && (ev.rows.has(site.key) || ev.joined?.has(site.key) === true);
    const project: Read["project"] =
      site.table === "projects" || !tableByName.get(site.table)!.underProject ? "n/a" : liveOf(ev) ? "live" : ev.scoped ? "parent" : "missing";
    const read: Read = { file: sf.fileName, line: lineOf(site.node), table: site.table, kind: site.kind, rows, project };
    const scope = markerScope(site.root);
    const covering = markers.filter((m) => m.file === sf.fileName && m.pos >= scope.getFullStart() && m.end <= site.root.getEnd());
    for (const m of covering) m.read.add(site.table);
    const fails = site.kind === "delete" || site.kind === "raw" || !rows || project === "missing";
    if (fails) {
      const marker = covering.find((m) => m.tables.includes(site.table));
      if (marker) {
        marker.used.add(site.table);
        read.marker = marker.reason;
      } else {
        const why =
          site.kind === "delete"
            ? "erases rows of a soft-deleted table"
            : site.kind === "raw"
              ? "names a soft-deleted table in sql.raw, which no check can read"
              : [!rows && `doesn't leave out deleted rows (isNull(${site.table}.deletedAt))`, project === "missing" && "doesn't leave out a deleted project's rows"].filter(Boolean).join(" and ");
        const as = site.alias ? ` (as ${site.alias})` : "";
        problems.push({ file: read.file, line: read.line, message: `${site.kind} of ${site.table}${as} ${why}` });
      }
    }
    reads.push(read);
  }
  for (const m of markers) {
    const at = { file: m.file, line: m.line };
    if (!m.named || m.tables.length === 0) problems.push({ ...at, message: "soft-delete-ok marker that names no table: soft-delete-ok(table, …): reason" });
    if (!m.reason) problems.push({ ...at, message: "soft-delete-ok marker without a reason" });
    for (const t of m.tables) {
      if (!isSoft(t)) problems.push({ ...at, message: `soft-delete-ok marker names ${t}, not a soft-deleted table` });
      else if (!m.read.has(t)) problems.push({ ...at, message: `soft-delete-ok marker names ${t}, which its query doesn't read` });
      else if (!m.used.has(t)) problems.push({ ...at, message: `soft-delete-ok marker names ${t}, whose reads need no excuse` });
    }
  }
  return { reads, problems };
}
