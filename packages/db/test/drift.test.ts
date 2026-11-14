import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { pushSchema } from "../src/ops/connection";
import {
  applyAllowList,
  checkDrift,
  compareSnapshots,
  formatReport,
  introspect,
  openReadOnly,
  readAllowList,
  type AllowEntry,
} from "../src/ops/drift";
import { dropScratch, resetScratch, runCli, scratchDatabase, SERVER_URL } from "./scratch";

afterEach(resetScratch);
afterAll(dropScratch);

/** A small schema with one of everything the check compares. */
const SCHEMA = `
  create type project_state as enum ('draft', 'building', 'done');
  create table tenants (
    id text primary key,
    name text not null
  );
  create table projects (
    id text primary key,
    tenant_id text not null,
    ref text not null,
    state project_state not null default 'draft',
    budget_cents integer,
    note text,
    created_at timestamp not null default now(),
    constraint projects_tenant_fk foreign key (tenant_id) references tenants (id) on delete cascade,
    constraint projects_ref_unique unique (tenant_id, ref),
    constraint projects_budget_check check (budget_cents >= 0)
  );
  create index projects_tenant_idx on projects (tenant_id);
  create unique index projects_ref_live on projects (ref) where note is null;
`;

/** The schema in one database, the schema plus `change` in the other (the target). */
async function drift(change: string, allow: AllowEntry[] = []) {
  // A test may compare several times: start each from empty databases.
  await resetScratch();
  const expected = await scratchDatabase();
  const target = await scratchDatabase();
  await expected.query(SCHEMA);
  await target.query(SCHEMA + change);
  return checkDrift(expected.url, target.url, allow);
}

const summary = (report: Awaited<ReturnType<typeof drift>>) =>
  report.drift.map((item) => `${item.group}: ${item.item} — ${item.detail}`);

describe("drift check", () => {
  it("finds no drift between two databases built alike", async () => {
    const report = await drift("");
    expect(report).toEqual({ drift: [], allowed: [], unused: [] });
    expect(formatReport(report)).toBe("No drift: the target matches schema.ts.");
  });

  it("reports a missing column", async () => {
    expect(summary(await drift("alter table projects drop column note cascade;"))).toEqual([
      "missing: column projects.note — text, nullable",
      // Its partial index went with it.
      "missing: index projects.projects_ref_live — CREATE UNIQUE INDEX ON public.projects USING btree (ref) WHERE (note IS NULL)",
    ]);
  });

  it("reports an extra table once, not column by column, and an extra column", async () => {
    const report = await drift(`
      create table legacy_orders (id int primary key, total numeric(12, 2) not null);
      alter table projects add column old_code varchar(20) default 'x';
    `);
    expect(summary(report)).toEqual([
      "extra: table legacy_orders — 2 columns",
      "extra: column projects.old_code — character varying(20), nullable, default 'x'::character varying",
    ]);
  });

  it("reports a changed nullability, type and default", async () => {
    const report = await drift(`
      alter table projects alter column ref drop not null;
      alter table projects alter column note set not null;
      alter table projects alter column budget_cents type bigint;
      alter table projects alter column created_at drop default;
      alter table tenants alter column name set default 'ViTAH';
    `);
    expect(summary(report)).toEqual([
      "different: column projects.budget_cents — type is bigint, schema.ts has integer",
      "different: column projects.created_at — default is none, schema.ts has now()",
      "different: column projects.note — is not null, schema.ts has it nullable",
      "different: column projects.ref — is nullable, schema.ts has it not null",
      "different: column tenants.name — default is 'ViTAH'::text, schema.ts has none",
    ]);
  });

  it("reports a foreign key with another on-delete rule, whatever its name", async () => {
    const report = await drift(`
      alter table projects drop constraint projects_tenant_fk;
      alter table projects add constraint legacy_name foreign key (tenant_id) references tenants (id) on delete set null;
    `);
    expect(summary(report)).toEqual([
      "different: foreign key projects(tenant_id) -> tenants(id) — is on delete set null, on update no action, " +
        "schema.ts has on delete cascade, on update no action",
    ]);
  });

  it("does not mind a foreign key under another name, but reports a missing, an extra and a doubled one", async () => {
    const renamed = await drift("alter table projects rename constraint projects_tenant_fk to fk_rails_1234;");
    expect(renamed.drift).toEqual([]);

    const report = await drift(`
      alter table projects add constraint again foreign key (tenant_id) references tenants (id) on delete cascade;
      alter table projects add column owner_id text references tenants (id);
    `);
    expect(summary(report)).toEqual([
      "extra: column projects.owner_id — text, nullable",
      "extra: foreign key projects(owner_id) -> tenants(id) — on delete no action, on update no action",
      "different: foreign key projects(tenant_id) -> tenants(id) — defined 2 times, schema.ts has it once",
    ]);

    const dropped = await drift("alter table projects drop constraint projects_tenant_fk;");
    expect(summary(dropped)).toEqual([
      "missing: foreign key projects(tenant_id) -> tenants(id) — on delete cascade, on update no action",
    ]);
  });

  it("compares indexes and constraints by definition, and says when only the name differs", async () => {
    const report = await drift(`
      drop index projects_tenant_idx;
      create index projects_tenant_idx on projects (tenant_id, ref);
      alter index projects_ref_live rename to projects_ref_partial;
      create index projects_state_idx on projects (state);
      alter table projects drop constraint projects_ref_unique;
      alter table projects drop constraint projects_budget_check;
      alter table projects add constraint projects_budget_check check (budget_cents > 0);
      alter table tenants rename constraint tenants_pkey to tenants_pk;
    `);
    expect(summary(report)).toEqual([
      "different: index projects.projects_tenant_idx — is CREATE INDEX ON public.projects USING btree (tenant_id, ref), " +
        "schema.ts has CREATE INDEX ON public.projects USING btree (tenant_id)",
      "different: index projects.projects_ref_live — is named projects_ref_partial in the target " +
        "(CREATE UNIQUE INDEX ON public.projects USING btree (ref) WHERE (note IS NULL))",
      "extra: index projects.projects_state_idx — CREATE INDEX ON public.projects USING btree (state)",
      "different: constraint projects.projects_budget_check — is CHECK ((budget_cents > 0)), " +
        "schema.ts has CHECK ((budget_cents >= 0))",
      "missing: constraint projects.projects_ref_unique — UNIQUE (tenant_id, ref)",
      "different: constraint tenants.tenants_pkey — is named tenants_pk in the target (PRIMARY KEY (id))",
    ]);
  });

  it("reports an enum that lacks or adds a value", async () => {
    const report = await drift(`
      alter type project_state add value 'archived';
      create type legacy_kind as enum ('a', 'b');
    `);
    expect(summary(report)).toEqual([
      "extra: enum legacy_kind — a, b",
      "different: enum project_state — also has archived",
    ]);
  });

  it("ignores the migration runner's own table", async () => {
    const report = await drift("create table schema_migrations (filename text primary key, checksum text not null);");
    expect(report.drift).toEqual([]);
  });

  it("groups the report as missing, extra, different", async () => {
    const text = formatReport(
      await drift(`
        alter table projects drop column budget_cents;
        create table legacy_orders (id int primary key);
        alter table projects alter column ref drop not null;
      `),
    );
    const headings = text.split("\n").filter((line) => /^\S/.test(line));
    expect(headings).toEqual([
      "Missing in the target (schema.ts has it): 2",
      "Extra in the target (schema.ts does not have it): 1",
      "Different: 1",
      "Drift: 4 differences between the target and schema.ts.",
    ]);
    expect(text).toContain("  column projects.ref\n      is nullable, schema.ts has it not null");
  });
});

describe("the allow-list", () => {
  const change = `
    create table legacy_orders (id int primary key);
    alter table projects add column old_code text;
    alter table projects alter column ref drop not null;
  `;

  it("suppresses the items it lists, and nothing else", async () => {
    const report = await drift(change, [
      { item: "table legacy_orders", reason: "kept from the old platform" },
      { item: "column projects.old_code", reason: "read by the accountant's export" },
    ]);

    expect(summary(report)).toEqual(["different: column projects.ref — is nullable, schema.ts has it not null"]);
    expect(report.allowed.map((item) => [item.item, item.reason])).toEqual([
      ["table legacy_orders", "kept from the old platform"],
      ["column projects.old_code", "read by the accountant's export"],
    ]);
    expect(formatReport(report)).toContain("  table legacy_orders (extra): kept from the old platform");
  });

  it("allows everything in a table listed whole, and reports entries that match nothing", async () => {
    const report = await drift(change, [
      { item: "table legacy_orders", reason: "old" },
      { item: "table projects", reason: "being reworked" },
      { item: "column tenants.gone", reason: "dropped long ago" },
    ]);

    expect(report.drift).toEqual([]);
    expect(report.allowed.map((item) => item.item)).toEqual([
      "table legacy_orders",
      "column projects.old_code",
      "column projects.ref",
    ]);
    expect(report.unused).toEqual([{ item: "column tenants.gone", reason: "dropped long ago" }]);
    expect(formatReport(report)).toContain("match nothing any more");
  });

  it("is a JSON file whose every entry gives a reason", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vitah-drift-"));
    try {
      const path = join(dir, "drift-allow.json");
      await writeFile(path, JSON.stringify({ ignore: [{ item: " table legacy_orders ", reason: "old platform" }] }));
      expect(await readAllowList(path)).toEqual([{ item: "table legacy_orders", reason: "old platform" }]);

      await writeFile(path, JSON.stringify({ ignore: [{ item: "table legacy_orders" }] }));
      await expect(readAllowList(path)).rejects.toThrow('entry 1 needs an "item" and a "reason"');
      await writeFile(path, JSON.stringify([]));
      await expect(readAllowList(path)).rejects.toThrow('expected { "ignore"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("matches by the item's exact words", () => {
    const items = compareSnapshots(
      { tables: new Map(), enums: new Map([["kind", ["a"]]]) },
      { tables: new Map(), enums: new Map() },
    );
    expect(applyAllowList(items, [{ item: "enum kinds", reason: "no" }]).drift).toHaveLength(1);
    expect(applyAllowList(items, [{ item: "enum kind", reason: "yes" }]).drift).toHaveLength(0);
  });
});

describe("reading the target", () => {
  it("cannot write to it", async () => {
    const target = await scratchDatabase();
    await target.query(SCHEMA);
    const sql = openReadOnly(target.url);
    try {
      await expect(sql`insert into tenants (id, name) values ('t', 'T')`).rejects.toThrow("read-only transaction");
      await expect(sql`create table sneaky (id int)`).rejects.toThrow("read-only transaction");
    } finally {
      await sql.end();
    }
    const snapshot = await introspect(target.url);
    expect([...snapshot.tables.keys()].sort()).toEqual(["projects", "tenants"]);
    expect(await target.tables()).toEqual(["projects", "tenants"]);
  });
});

describe("db:drift, the command", () => {
  it("passes on a database pushed from schema.ts and fails once it drifts, without printing a URL", async () => {
    const target = await scratchDatabase();
    pushSchema(target.url);
    const env = { DRIFT_URL: target.url, DRIFT_SCRATCH_URL: SERVER_URL };

    const clean = await runCli("drift-cli.ts", [], env);
    expect(clean.stderr).toBe("");
    expect(clean.code).toBe(0);
    expect(clean.stdout).toContain("No drift: the target matches schema.ts.");

    await target.query(`
      alter table projects add column legacy_code text;
      alter table users alter column email drop not null;
      create table schema_migrations (filename text primary key);
    `);
    // With an allow-list that covers one of the two differences.
    const dir = await mkdtemp(join(tmpdir(), "vitah-drift-"));
    try {
      const allow = join(dir, "allow.json");
      await writeFile(allow, JSON.stringify({ ignore: [{ item: "column projects.legacy_code", reason: "known" }] }));
      const drifted = await runCli("drift-cli.ts", [], { ...env, DRIFT_ALLOW: allow });
      expect(drifted.code).toBe(1);
      expect(drifted.stdout).toMatch(/Different: 1\n  column users\.email\n/);
      expect(drifted.stdout).toContain("  column projects.legacy_code (extra): known");
      expect(drifted.stdout).toContain("Drift: 1 difference between");
      for (const output of [clean, drifted]) {
        expect(output.stdout + output.stderr).not.toContain(new URL(target.url).password);
        expect(output.stdout + output.stderr).not.toContain("postgres://");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect((await runCli("drift-cli.ts", [], {})).code).toBe(2);
  }, 120_000);
});
