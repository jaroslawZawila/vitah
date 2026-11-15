// The drift check: what a database has against what `schema.ts` defines.
// Both sides are read the same way from pg_catalog, then compared. Reading the
// target is strictly read-only.

import { readFile } from "node:fs/promises";
import postgres from "postgres";

/** The runner's own table: in every migrated database, deliberately not in `schema.ts`. */
const IGNORED_TABLES = new Set(["schema_migrations"]);

type Column = { type: string; notNull: boolean; default: string | null; generated: string | null };
type Named = { name: string; def: string };
type ForeignKey = { name: string; signature: string; rules: string; validated: boolean };
type Table = {
  columns: Map<string, Column>;
  /** Indexes that don't back a constraint; `def` without the index's name. */
  indexes: Named[];
  /** Primary-key, unique and check constraints. */
  constraints: Named[];
  foreignKeys: ForeignKey[];
};
export type Snapshot = { tables: Map<string, Table>; enums: Map<string, string[]> };

const FK_ACTIONS: Record<string, string> = {
  a: "no action",
  r: "restrict",
  c: "cascade",
  n: "set null",
  d: "set default",
};

/** A connection that cannot write: every transaction of its session is read-only, from the start. */
export function openReadOnly(url: string) {
  return postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 30,
    onnotice: () => {},
    connection: { default_transaction_read_only: true },
  });
}

/**
 * Reads the `public` schema of a database: tables, columns, indexes,
 * constraints and enum types. One read-only transaction, so it is a single
 * consistent picture and cannot change anything whatever the connection is.
 */
export async function introspect(url: string): Promise<Snapshot> {
  const sql = openReadOnly(url);
  try {
    return await sql.begin("isolation level repeatable read read only", async (tx) => {
      // Type and expression text is printed relative to the search path: pin
      // it, so both databases are described in the same words.
      await tx`set local search_path = public`;

      const columns = await tx<
        { table: string; name: string; type: string; notNull: boolean; default: string | null; generated: string }[]
      >`
        select c.relname as "table", a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
               a.attnotnull as "notNull", pg_get_expr(d.adbin, d.adrelid) as "default",
               a.attidentity::text || a.attgenerated::text as generated
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
        order by c.relname, a.attnum`;

      const tables = await tx<{ name: string }[]>`
        select c.relname as name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')`;

      const indexes = await tx<{ table: string; name: string; def: string }[]>`
        select c.relname as "table", i.relname as name,
               replace(pg_get_indexdef(x.indexrelid), ' INDEX ' || quote_ident(i.relname) || ' ON ', ' INDEX ON ')
                 || case when x.indisvalid then '' else ' (INVALID)' end as def
        from pg_index x
        join pg_class i on i.oid = x.indexrelid
        join pg_class c on c.oid = x.indrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
          and not exists (select 1 from pg_constraint k where k.conindid = x.indexrelid and k.contype in ('p', 'u', 'x'))
        order by c.relname, i.relname`;

      const constraints = await tx<
        {
          table: string;
          name: string;
          type: string;
          def: string;
          columns: string[];
          refTable: string | null;
          refColumns: string[] | null;
          onDelete: string;
          onUpdate: string;
          validated: boolean;
        }[]
      >`
        select c.relname as "table", k.conname as name, k.contype as type, pg_get_constraintdef(k.oid) as def,
               (select array_agg(a.attname order by u.ord)
                  from unnest(k.conkey) with ordinality u(attnum, ord)
                  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum) as columns,
               r.relname as "refTable",
               (select array_agg(a.attname order by u.ord)
                  from unnest(k.confkey) with ordinality u(attnum, ord)
                  join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.attnum) as "refColumns",
               k.confdeltype as "onDelete", k.confupdtype as "onUpdate", k.convalidated as validated
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_class r on r.oid = k.confrelid
        where n.nspname = 'public' and c.relkind in ('r', 'p') and k.contype in ('p', 'u', 'c', 'f')
        order by c.relname, k.conname`;

      const enums = await tx<{ name: string; labels: string[] }[]>`
        select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
        from pg_type t
        join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public'
        group by t.typname`;

      const snapshot: Snapshot = { tables: new Map(), enums: new Map() };
      for (const { name } of tables) {
        snapshot.tables.set(name, { columns: new Map(), indexes: [], constraints: [], foreignKeys: [] });
      }
      for (const column of columns) {
        snapshot.tables.get(column.table)?.columns.set(column.name, {
          type: column.type,
          notNull: column.notNull,
          default: column.default,
          generated: column.generated.trim() || null,
        });
      }
      for (const index of indexes) snapshot.tables.get(index.table)?.indexes.push({ name: index.name, def: index.def });
      for (const k of constraints) {
        const table = snapshot.tables.get(k.table);
        if (!table) continue;
        if (k.type === "f") {
          table.foreignKeys.push({
            name: k.name,
            signature: `(${k.columns.join(", ")}) -> ${k.refTable}(${(k.refColumns ?? []).join(", ")})`,
            rules: `on delete ${FK_ACTIONS[k.onDelete] ?? k.onDelete}, on update ${FK_ACTIONS[k.onUpdate] ?? k.onUpdate}`,
            validated: k.validated,
          });
        } else table.constraints.push({ name: k.name, def: k.def });
      }
      for (const { name, labels } of enums) snapshot.enums.set(name, labels);
      return snapshot;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// --- Comparing ---------------------------------------------------------------

export type DriftGroup = "missing" | "extra" | "different";
export type DriftItem = {
  group: DriftGroup;
  /** What the allow-list names: `table x`, `column x.y`, `index x.name`, `constraint x.name`, `foreign key x(…) -> y(…)`, `enum x`. */
  item: string;
  detail: string;
  /** The table it belongs to: allowing `table x` allows all of it. */
  table: string | null;
};

const sorted = <T>(values: Iterable<T>) => [...values].sort();

function describeColumn(column: Column): string {
  return [
    column.type,
    column.notNull ? "not null" : "nullable",
    column.default !== null && `default ${column.default}`,
    column.generated && `generated (${column.generated})`,
  ]
    .filter(Boolean)
    .join(", ");
}

function compareColumn(expected: Column, target: Column): string[] {
  const differences: string[] = [];
  if (expected.type !== target.type) differences.push(`type is ${target.type}, schema.ts has ${expected.type}`);
  if (expected.notNull !== target.notNull) {
    differences.push(target.notNull ? "is not null, schema.ts has it nullable" : "is nullable, schema.ts has it not null");
  }
  if (expected.default !== target.default) {
    differences.push(`default is ${target.default ?? "none"}, schema.ts has ${expected.default ?? "none"}`);
  }
  if (expected.generated !== target.generated) {
    differences.push(`identity/generated is ${target.generated ?? "none"}, schema.ts has ${expected.generated ?? "none"}`);
  }
  return differences;
}

/**
 * Indexes and constraints: paired by name first (same name, another
 * definition), then by definition (same thing under another name, which
 * matters: the code tells unique violations apart by constraint name), and
 * what is left is missing or extra.
 */
function compareNamed(kind: "index" | "constraint", table: string, expected: Named[], target: Named[]): DriftItem[] {
  const items: DriftItem[] = [];
  let right = [...target];
  const take = (match: (candidate: Named) => boolean) => {
    const found = right.find(match);
    if (found) right = right.filter((candidate) => candidate !== found);
    return found;
  };

  const unnamed: Named[] = [];
  for (const want of expected) {
    const same = take((candidate) => candidate.name === want.name);
    if (!same) unnamed.push(want);
    else if (same.def === `${want.def} NOT VALID`) {
      items.push({ group: "different", item: `${kind} ${table}.${want.name}`, detail: notValidated(table, want.name), table });
    } else if (same.def !== want.def) {
      items.push({
        group: "different",
        item: `${kind} ${table}.${want.name}`,
        detail: `is ${same.def}, schema.ts has ${want.def}`,
        table,
      });
    }
  }
  for (const want of unnamed) {
    const renamed = take((candidate) => candidate.def === want.def || candidate.def === `${want.def} NOT VALID`);
    if (renamed) {
      items.push({
        group: "different",
        item: `${kind} ${table}.${want.name}`,
        detail: `is named ${renamed.name} in the target (${want.def})${renamed.def === want.def ? "" : `; ${notValidated(table, renamed.name)}`}`,
        table,
      });
    } else items.push({ group: "missing", item: `${kind} ${table}.${want.name}`, detail: want.def, table });
  }
  for (const extra of right) {
    items.push({ group: "extra", item: `${kind} ${table}.${extra.name}`, detail: extra.def, table });
  }
  return items;
}

/**
 * A constraint added NOT VALID whose validation failed or never ran: new writes
 * are checked, the rows already there never were.
 */
const notValidated = (table: string, name: string) =>
  `NOT VALID: the rows from before it was added were never checked. Fix those that break it, then ` +
  `ALTER TABLE ${table} VALIDATE CONSTRAINT ${name}`;

/** Foreign keys by what they say (columns, referenced table, rules), never by name: production's names differ. */
function compareForeignKeys(table: string, expected: ForeignKey[], target: ForeignKey[]): DriftItem[] {
  const items: DriftItem[] = [];
  const bySignature = (keys: ForeignKey[]) => {
    const map = new Map<string, string[]>();
    for (const key of keys) map.set(key.signature, [...(map.get(key.signature) ?? []), key.rules]);
    return map;
  };
  const rules = (list: string[]) => sorted(new Set(list)).join("; ");
  const want = bySignature(expected);
  const have = bySignature(target);
  for (const signature of sorted(new Set([...want.keys(), ...have.keys()]))) {
    const item = `foreign key ${table}${signature}`;
    const wanted = want.get(signature);
    const found = have.get(signature);
    if (!found) items.push({ group: "missing", item, detail: rules(wanted!), table });
    else if (!wanted) items.push({ group: "extra", item, detail: rules(found), table });
    else if (rules(found) !== rules(wanted)) {
      items.push({ group: "different", item, detail: `is ${rules(found)}, schema.ts has ${rules(wanted)}`, table });
    } else if (found.length !== wanted.length) {
      const detail = `defined ${found.length} times, schema.ts has it ${wanted.length === 1 ? "once" : `${wanted.length} times`}`;
      items.push({ group: "different", item, detail, table });
    } else {
      const unvalidated = target.find((key) => key.signature === signature && !key.validated);
      if (unvalidated) items.push({ group: "different", item, detail: notValidated(table, unvalidated.name), table });
    }
  }
  return items;
}

/** Every difference between what `schema.ts` builds (`expected`) and the target. */
export function compareSnapshots(expected: Snapshot, target: Snapshot): DriftItem[] {
  const items: DriftItem[] = [];
  const tableNames = sorted(new Set([...expected.tables.keys(), ...target.tables.keys()]));

  for (const name of tableNames) {
    if (IGNORED_TABLES.has(name)) continue;
    const want = expected.tables.get(name);
    const have = target.tables.get(name);
    if (!have) {
      items.push({ group: "missing", item: `table ${name}`, detail: `${want!.columns.size} columns`, table: name });
      continue;
    }
    if (!want) {
      items.push({ group: "extra", item: `table ${name}`, detail: `${have.columns.size} columns`, table: name });
      continue;
    }

    for (const column of sorted(new Set([...want.columns.keys(), ...have.columns.keys()]))) {
      const item = `column ${name}.${column}`;
      const wanted = want.columns.get(column);
      const found = have.columns.get(column);
      if (!found) items.push({ group: "missing", item, detail: describeColumn(wanted!), table: name });
      else if (!wanted) items.push({ group: "extra", item, detail: describeColumn(found), table: name });
      else {
        const differences = compareColumn(wanted, found);
        if (differences.length > 0) items.push({ group: "different", item, detail: differences.join("; "), table: name });
      }
    }
    items.push(...compareNamed("index", name, want.indexes, have.indexes));
    items.push(...compareNamed("constraint", name, want.constraints, have.constraints));
    items.push(...compareForeignKeys(name, want.foreignKeys, have.foreignKeys));
  }

  for (const name of sorted(new Set([...expected.enums.keys(), ...target.enums.keys()]))) {
    const item = `enum ${name}`;
    const wanted = expected.enums.get(name);
    const found = target.enums.get(name);
    if (!found) items.push({ group: "missing", item, detail: wanted!.join(", "), table: null });
    else if (!wanted) items.push({ group: "extra", item, detail: found.join(", "), table: null });
    else if (wanted.join("\n") !== found.join("\n")) {
      const lacks = wanted.filter((label) => !found.includes(label));
      const spare = found.filter((label) => !wanted.includes(label));
      const detail = [
        lacks.length > 0 && `lacks ${lacks.join(", ")}`,
        spare.length > 0 && `also has ${spare.join(", ")}`,
        lacks.length === 0 && spare.length === 0 && `values are in another order: ${found.join(", ")}`,
      ]
        .filter(Boolean)
        .join("; ");
      items.push({ group: "different", item, detail, table: null });
    }
  }
  return items;
}

// --- The allow-list ------------------------------------------------------------

export type AllowEntry = { item: string; reason: string };
export type DriftReport = {
  /** Differences nothing allows: any of these fails the check. */
  drift: DriftItem[];
  allowed: (DriftItem & { reason: string })[];
  /** Entries that matched nothing: the difference is gone, the entry can go. */
  unused: AllowEntry[];
};

/** Reads `drift-allow.json`: `{ "ignore": [{ "item": "table legacy_x", "reason": "…" }] }`. */
export async function readAllowList(path: string): Promise<AllowEntry[]> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  const ignore = (parsed as { ignore?: unknown }).ignore;
  if (!Array.isArray(ignore)) throw new Error(`${path}: expected { "ignore": [ … ] }`);
  return ignore.map((entry: unknown, index) => {
    const { item, reason } = (entry ?? {}) as { item?: unknown; reason?: unknown };
    if (typeof item !== "string" || !item.trim() || typeof reason !== "string" || !reason.trim()) {
      throw new Error(`${path}: entry ${index + 1} needs an "item" and a "reason"`);
    }
    return { item: item.trim(), reason: reason.trim() };
  });
}

/** Splits the differences into those the allow-list covers and real drift. */
export function applyAllowList(items: DriftItem[], allow: AllowEntry[]): DriftReport {
  const used = new Set<AllowEntry>();
  const report: DriftReport = { drift: [], allowed: [], unused: [] };
  for (const item of items) {
    const entry = allow.find(
      (candidate) => candidate.item === item.item || (item.table !== null && candidate.item === `table ${item.table}`),
    );
    if (entry) {
      used.add(entry);
      report.allowed.push({ ...item, reason: entry.reason });
    } else report.drift.push(item);
  }
  report.unused = allow.filter((entry) => !used.has(entry));
  return report;
}

const TITLES: Record<DriftGroup, string> = {
  missing: "Missing in the target (schema.ts has it)",
  extra: "Extra in the target (schema.ts does not have it)",
  different: "Different",
};

export function formatReport(report: DriftReport): string {
  const lines: string[] = [];
  for (const group of ["missing", "extra", "different"] as const) {
    const items = report.drift.filter((item) => item.group === group);
    if (items.length === 0) continue;
    lines.push(`${TITLES[group]}: ${items.length}`);
    for (const item of items) lines.push(`  ${item.item}\n      ${item.detail}`);
    lines.push("");
  }
  if (report.allowed.length > 0) {
    lines.push(`Allowed by drift-allow.json: ${report.allowed.length}`);
    for (const item of report.allowed) lines.push(`  ${item.item} (${item.group}): ${item.reason}`);
    lines.push("");
  }
  if (report.unused.length > 0) {
    lines.push(`Allow-list entries that match nothing any more (remove them): ${report.unused.length}`);
    for (const entry of report.unused) lines.push(`  ${entry.item}`);
    lines.push("");
  }
  lines.push(
    report.drift.length === 0
      ? "No drift: the target matches schema.ts."
      : `Drift: ${report.drift.length} difference${report.drift.length === 1 ? "" : "s"} between the target and schema.ts.`,
  );
  return lines.join("\n");
}

/** Compares the database at `targetUrl` with the one at `expectedUrl` (built from `schema.ts`). */
export async function checkDrift(expectedUrl: string, targetUrl: string, allow: AllowEntry[]): Promise<DriftReport> {
  const expected = await introspect(expectedUrl);
  const target = await introspect(targetUrl);
  return applyAllowList(compareSnapshots(expected, target), allow);
}
