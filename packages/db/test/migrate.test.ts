import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { redactor } from "../src/ops/connection";
import {
  MigrationFailed,
  baseline,
  compareNames,
  deployMigrations,
  looksPooled,
  migrate,
  migrationStatus,
  planMigrations,
  resolveTarget,
} from "../src/ops/migrate";
import { declaresNoTransaction, hasOwnTransaction, splitStatements, transactionControl } from "../src/ops/sql-scan";
import { dropScratch, migrationsDir, resetScratch, runCli, scratchDatabase, type Scratch } from "./scratch";

afterEach(resetScratch);
afterAll(dropScratch);

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const records = (db: Scratch) =>
  db.query<{ filename: string; checksum: string; baseline: boolean }>(
    "select filename, checksum, baseline from schema_migrations order by applied_at, filename",
  );

/** Three files that only work in name order. Not safe to run twice. */
const CHAIN = {
  "2026-11-14-0900-items.sql": "create table items (id int primary key);",
  "2026-11-14-0901-item-name.sql": "alter table items add column name text not null;",
  "2026-11-15-0000-first-item.sql": "insert into items (id, name) values (1, 'first');",
};

describe("migrate", () => {
  it("applies the pending files in name order and records each one", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);
    const log: string[] = [];

    const result = await migrate({ url: db.url, dir, log: (line) => log.push(line) });

    expect(result.applied).toEqual(Object.keys(CHAIN));
    expect(await db.query("select id, name from items")).toEqual([{ id: 1, name: "first" }]);
    expect(await records(db)).toEqual(
      Object.entries(CHAIN).map(([filename, sql]) => ({ filename, checksum: sha256(sql), baseline: false })),
    );
    expect(log.filter((line) => line.startsWith("applied"))).toHaveLength(3);
  });

  it("runs the old month-only names before every timestamped one", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({
      // By plain name order this one would come first, and fail.
      "2026-11-14-0900-item-name.sql": "alter table items add column name text;",
      "2026-11-items.sql": "create table items (id int primary key);",
    });

    const { applied } = await migrate({ url: db.url, dir });

    expect(applied).toEqual(["2026-11-items.sql", "2026-11-14-0900-item-name.sql"]);
    expect(compareNames("2026-12-z.sql", "2026-11-14-0900-a.sql")).toBeLessThan(0);
  });

  it("does nothing the second time", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);
    await migrate({ url: db.url, dir });

    const again = await migrate({ url: db.url, dir });

    expect(again.applied).toEqual([]);
    expect(await db.query("select count(*)::int as n from items")).toEqual([{ n: 1 }]);
    expect(await records(db)).toHaveLength(3);
  });

  it("applies only what is new on a later run", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);
    await migrate({ url: db.url, dir });
    await writeFile(join(dir, "2026-11-16-1200-second-item.sql"), "insert into items (id, name) values (2, 'second');");

    const { applied } = await migrate({ url: db.url, dir });

    expect(applied).toEqual(["2026-11-16-1200-second-item.sql"]);
    expect(await db.query("select count(*)::int as n from items")).toEqual([{ n: 2 }]);
  });

  it("stops at a failing file, undoes all of it and leaves the later ones pending", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({
      "2026-11-14-0900-items.sql": "create table items (id int primary key);",
      "2026-11-14-0901-broken.sql": "create table half_done (id int);\nselect 1 / 0;",
      "2026-11-14-0902-later.sql": "create table later (id int);",
    });

    const error = await migrate({ url: db.url, dir }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MigrationFailed);
    const failure = error as MigrationFailed;
    expect(failure.failed).toBe("2026-11-14-0901-broken.sql");
    expect(failure.applied).toEqual(["2026-11-14-0900-items.sql"]);
    expect(failure.pending).toEqual(["2026-11-14-0902-later.sql"]);
    expect(failure.message).toContain("2026-11-14-0901-broken.sql failed: division by zero");
    expect(failure.message).toContain("Not applied: 2026-11-14-0902-later.sql");
    // The broken file ran in one transaction with its record: nothing of it stays.
    expect(await db.tables()).toEqual(["items", "schema_migrations"]);
    expect((await records(db)).map((row) => row.filename)).toEqual(["2026-11-14-0900-items.sql"]);

    const status = await migrationStatus({ url: db.url, dir });
    expect(status.files.map((file) => file.state)).toEqual(["applied", "pending", "pending"]);
  });

  it("says which line of the file a syntax error is on", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({
      "2026-11-14-0900-typo.sql": "-- a comment\ncreate table ok (id int);\ncreate tabel oops (id int);\n",
    });

    await expect(migrate({ url: db.url, dir })).rejects.toThrow(/2026-11-14-0900-typo\.sql failed at line 3: /);
  });

  it("runs an old-style file with its own BEGIN/COMMIT as written, and records it", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({
      "2026-11-own.sql": "BEGIN;\ncreate table a (id int);\nCOMMIT;\n\nBEGIN;\ncreate table b (id int);\nCOMMIT;\n",
      // The BEGIN of a DO block is not a transaction: this one is wrapped.
      "2026-11-14-0901-do.sql":
        "DO $$\nBEGIN\n  EXECUTE 'create table c (id int)';\nEND $$;\n-- BEGIN; in a comment\nselect 'BEGIN; COMMIT;';",
    });

    await migrate({ url: db.url, dir });

    expect(await db.tables()).toEqual(["a", "b", "c", "schema_migrations"]);
    expect(await records(db)).toHaveLength(2);
  });

  it("keeps what an old-style file committed itself before failing, and does not record it", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({
      "2026-11-own.sql":
        "BEGIN;\ncreate table kept (id int);\nCOMMIT;\nBEGIN;\ncreate table lost (id int);\nselect 1 / 0;\nCOMMIT;\n",
      "2026-11-14-0901-later.sql": "create table later (id int);",
    });

    await expect(migrate({ url: db.url, dir })).rejects.toThrow("division by zero");

    expect(await db.tables()).toEqual(["kept", "schema_migrations"]);
    expect(await records(db)).toEqual([]);
  });

  it("fails an old-style file that leaves its transaction open", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({ "2026-11-open.sql": "BEGIN;\ncreate table dangling (id int);\n" });

    await expect(migrate({ url: db.url, dir })).rejects.toThrow("left a transaction open");

    expect(await db.tables()).toEqual(["schema_migrations"]);
    expect(await records(db)).toEqual([]);
  });

  it("does not let one file's SET reach the next", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({
      "2026-11-14-0900-set.sql": "set search_path = pg_catalog;\nset statement_timeout = '7s';",
      "2026-11-14-0901-read.sql": "create table public.seen as select current_setting('statement_timeout') as timeout;",
    });

    await migrate({ url: db.url, dir });

    expect(await db.query("select timeout from seen")).toEqual([{ timeout: "0" }]);
    expect(await records(db)).toHaveLength(2);
  });

  it("reports an applied file that changed, and refuses to go on", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);
    await migrate({ url: db.url, dir });
    await writeFile(join(dir, "2026-11-14-0901-item-name.sql"), "alter table items add column name text;");
    await writeFile(join(dir, "2026-11-16-1200-more.sql"), "create table more (id int);");

    const status = await migrationStatus({ url: db.url, dir });
    expect(status.files.map((file) => [file.filename, file.state])).toEqual([
      ["2026-11-14-0900-items.sql", "applied"],
      ["2026-11-14-0901-item-name.sql", "changed"],
      ["2026-11-15-0000-first-item.sql", "applied"],
      ["2026-11-16-1200-more.sql", "pending"],
    ]);
    expect(status.problems).toHaveLength(1);
    expect(status.problems[0]).toContain("2026-11-14-0901-item-name.sql changed after it was applied");

    await expect(migrate({ url: db.url, dir })).rejects.toThrow("changed after it was applied");
    expect(await db.tables()).not.toContain("more");
  });

  it("refuses a database that has tables but no recorded migration, and says to baseline", async () => {
    const db = await scratchDatabase();
    await db.query("create table projects (id int primary key)");
    const dir = await migrationsDir({ "2026-09-old.sql": "drop table projects;" });

    await expect(migrate({ url: db.url, dir })).rejects.toThrow(/already has tables \(e\.g\. "projects"\).*db:sql:baseline/s);

    // Untouched: not even its own table.
    expect(await db.tables()).toEqual(["projects"]);
    const status = await migrationStatus({ url: db.url, dir });
    expect(status.problems[0]).toContain("db:sql:baseline");

    // The same with an empty schema_migrations left behind.
    await db.query(
      "create table schema_migrations (filename text primary key, checksum text not null, applied_at timestamptz not null default now(), baseline boolean not null default false)",
    );
    await expect(migrate({ url: db.url, dir })).rejects.toThrow("db:sql:baseline");
    expect(await db.tables()).toEqual(["projects", "schema_migrations"]);
  });

  it("never applies a file twice when two runs start together", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({
      "2026-11-14-0900-slow.sql": "select pg_sleep(0.4);\ncreate table once (id int);",
      "2026-11-14-0901-row.sql": "insert into once values (1);",
    });

    const runs = await Promise.all([migrate({ url: db.url, dir }), migrate({ url: db.url, dir })]);

    expect(runs.map((run) => run.applied.length).sort()).toEqual([0, 2]);
    expect(await db.query("select count(*)::int as n from once")).toEqual([{ n: 1 }]);
    expect(await records(db)).toHaveLength(2);
  });

  it("gives up when another run keeps the lock", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({ "2026-11-14-0900-slow.sql": "select pg_sleep(1.5);" });

    const first = migrate({ url: db.url, dir });
    await new Promise((done) => setTimeout(done, 300));
    await expect(migrate({ url: db.url, dir, lockTimeoutMs: 100 })).rejects.toThrow("still holds the lock");
    expect((await first).applied).toHaveLength(1);
  });
});

describe("a new file and its transaction", () => {
  it("refuses a new file with its own BEGIN/COMMIT, naming it, before anything runs", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({
      "2026-11-14-0900-fine.sql": "create table fine (id int);",
      "2026-11-14-0901-own.sql": "-- two steps\ncreate table a (id int);\nBEGIN;\ncreate table b (id int);\nCOMMIT;\n",
    });

    const status = await migrationStatus({ url: db.url, dir });
    expect(status.problems).toEqual([
      expect.stringMatching(/^2026-11-14-0901-own\.sql has transaction control of its own \(BEGIN at line 3\)\..*-- migrate: no-transaction/s),
    ]);
    await expect(migrate({ url: db.url, dir })).rejects.toThrow("2026-11-14-0901-own.sql has transaction control of its own");
    // Not even the file before it.
    expect(await db.tables()).toEqual([]);
    expect((await run("status", { MIGRATE_URL: db.url, MIGRATIONS_DIR: dir })).code).toBe(1);
  });

  const problemsOf = (filename: string, sql: string) =>
    planMigrations([{ filename, sql, checksum: sha256(sql) }], [], null).problems;

  it.each([
    ["BEGIN;\nselect 1;\nCOMMIT;", "BEGIN at line 1"],
    ["select 1;\n\nstart   transaction;\nselect 2;\ncommit;", "START TRANSACTION at line 3"],
    ["select 1;\nCOMMIT;", "COMMIT at line 2"],
    ["select 1;\n/* why */ rollback;", "ROLLBACK at line 2"],
    ["select 1;\nEND;", "END at line 2"],
    ["begin transaction isolation level serializable; select 1; end transaction;", "BEGIN at line 1"],
    // Further down it is only a comment: the file is not exempt.
    ["-- adds an index\n-- migrate: no-transaction\nBEGIN; COMMIT;", "BEGIN at line 3"],
  ])("refuses %j (%s)", (sql, where) => {
    expect(problemsOf("2026-11-14-0900-x.sql", sql)).toEqual([expect.stringContaining(`(${where})`)]);
  });

  it.each([
    "create table a (id int);\ncreate index a_id on a (id);",
    "DO $$\nBEGIN\n  PERFORM 1;\nEXCEPTION WHEN others THEN\n  ROLLBACK;\nEND $$;",
    "-- BEGIN;\n/* COMMIT; */\nselect 'BEGIN; COMMIT; ROLLBACK;', $q$ END; $q$;",
    "create function f() returns int language sql BEGIN ATOMIC select 1; select 2; END;\nselect f();",
    "savepoint a;\nselect 1;\nrollback to savepoint a;\nrollback to a;\nrelease a;",
    "comment on column a.begin is 'x'; select 1 as commit;",
  ])("accepts %j: no transaction control at statement level", (sql) => {
    expect(problemsOf("2026-11-14-0900-x.sql", sql)).toEqual([]);
  });

  it("leaves the old month-only names alone: they are only ever baselined", () => {
    expect(problemsOf("2026-11-own.sql", "BEGIN;\nselect 1;\nCOMMIT;")).toEqual([]);
  });

  it("checks only what is still to run: a file recorded by hand is not looked at again", () => {
    const sql = "BEGIN;\nselect 1;\nCOMMIT;";
    const file = { filename: "2026-11-14-0900-by-hand.sql", sql, checksum: sha256(sql) };

    expect(planMigrations([file], [{ ...file, appliedAt: new Date(), baseline: true }], "projects").problems).toEqual([]);
  });

  it("runs a file marked no-transaction statement by statement, outside any transaction, and records it after", async () => {
    const db = await scratchDatabase();
    const body = "create table if not exists t (id int, note text);\ncreate index concurrently if not exists t_id on t (id);\ninsert into t values (1, 'a;b');\n";
    const dir = await migrationsDir({
      "2026-11-14-0900-index.sql": `-- migrate: no-transaction\n${body}`,
    });

    expect((await migrationStatus({ url: db.url, dir })).problems).toEqual([]);
    expect((await migrate({ url: db.url, dir })).applied).toEqual(["2026-11-14-0900-index.sql"]);

    expect(await db.query("select indexname from pg_indexes where tablename = 't'")).toEqual([{ indexname: "t_id" }]);
    expect(await db.query("select note from t")).toEqual([{ note: "a;b" }]);
    expect((await records(db)).map((row) => row.filename)).toEqual(["2026-11-14-0900-index.sql"]);

    // The same statements without the first line run in a transaction, where the index can't be built: nothing stays.
    const other = await scratchDatabase();
    const wrapped = await migrationsDir({ "2026-11-14-0900-index.sql": body });
    await expect(migrate({ url: other.url, dir: wrapped })).rejects.toThrow(/CREATE INDEX CONCURRENTLY cannot run inside a transaction block/);
    expect(await other.tables()).toEqual(["schema_migrations"]);
  });

  it("keeps what a no-transaction file did before failing, does not record it, and runs it again from the top", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({
      "2026-11-14-0859-first.sql": "create table first (id int);",
      "2026-11-14-0900-index.sql":
        "-- migrate: no-transaction\ncreate table if not exists kept (id int);\n\nselect count(*)\n  from missing;\ncreate table never (id int);\n",
      "2026-11-14-0901-later.sql": "create table later (id int);",
    });

    const error = await migrate({ url: db.url, dir }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MigrationFailed);
    expect((error as MigrationFailed).message).toMatch(/2026-11-14-0900-index\.sql failed at line 5: relation "missing" does not exist/);
    expect((error as MigrationFailed).message).toContain("what its earlier statements did stays, and it is not recorded");
    expect((error as MigrationFailed).pending).toEqual(["2026-11-14-0901-later.sql"]);
    expect(await db.tables()).toEqual(["first", "kept", "schema_migrations"]);
    expect((await records(db)).map((row) => row.filename)).toEqual(["2026-11-14-0859-first.sql"]);

    // Safe to run twice, as the README asks of such a file: the next run starts it over.
    await db.query("create table missing (id int)");
    expect((await migrate({ url: db.url, dir })).applied).toEqual(["2026-11-14-0900-index.sql", "2026-11-14-0901-later.sql"]);
    expect(await db.tables()).toEqual(["first", "kept", "later", "missing", "never", "schema_migrations"]);
  });

  it("lets a no-transaction file open and commit its own, and fails one left open", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({
      "2026-11-14-0900-own.sql": "-- migrate: no-transaction\nBEGIN;\ncreate table a (id int);\nCOMMIT;\ncreate table b (id int);\n",
    });

    await migrate({ url: db.url, dir });
    expect(await db.tables()).toEqual(["a", "b", "schema_migrations"]);

    await writeFile(join(dir, "2026-11-14-0901-open.sql"), "-- migrate: no-transaction\nBEGIN;\ncreate table dangling (id int);\n");
    await expect(migrate({ url: db.url, dir })).rejects.toThrow("left a transaction open");
    expect(await db.tables()).toEqual(["a", "b", "schema_migrations"]);
    expect(await records(db)).toHaveLength(1);

    // A statement failing inside the file's own transaction ends it: the next file starts clean.
    await writeFile(join(dir, "2026-11-14-0901-open.sql"), "-- migrate: no-transaction\nBEGIN;\ncreate table dangling (id int);\nselect 1 / 0;\nCOMMIT;\n");
    const log: string[] = [];
    await expect(migrate({ url: db.url, dir, log: (line) => log.push(line) })).rejects.toThrow("division by zero");
    expect(await db.tables()).toEqual(["a", "b", "schema_migrations"]);
    await writeFile(join(dir, "2026-11-14-0901-open.sql"), "-- migrate: no-transaction\ncreate table c (id int);\nselect 1 / 0;\n");
    await expect(migrate({ url: db.url, dir, log: (line) => log.push(line) })).rejects.toThrow("division by zero");
    expect(await db.tables()).toEqual(["a", "b", "c", "schema_migrations"]);
    // No ROLLBACK is sent where there is nothing to roll back.
    expect(log.join("\n")).not.toContain("no transaction in progress");
  });

  it("records a new file in the same transaction as what it does: a record that can't be written undoes the file", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({
      "2026-11-14-0900-items.sql": "create table items (id int primary key);",
      // Its own record can't go in: the file takes the table away.
      "2026-11-14-0901-sabotage.sql": "create table made (id int);\ndrop table schema_migrations;",
    });

    await expect(migrate({ url: db.url, dir })).rejects.toThrow("2026-11-14-0901-sabotage.sql failed");

    expect(await db.tables()).toEqual(["items", "schema_migrations"]);
    expect((await records(db)).map((row) => row.filename)).toEqual(["2026-11-14-0900-items.sql"]);
  });
});

describe("the order of new files", () => {
  it("refuses a pending file that sorts before one already applied", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);
    await migrate({ url: db.url, dir });
    await writeFile(join(dir, "2026-11-14-2359-late.sql"), "create table late (id int);");

    const status = await migrationStatus({ url: db.url, dir });
    expect(status.problems).toEqual([
      expect.stringContaining("2026-11-14-2359-late.sql is pending but sorts before 2026-11-15-0000-first-item.sql"),
    ]);
    await expect(migrate({ url: db.url, dir })).rejects.toThrow("sorts before");
    expect(await db.tables()).not.toContain("late");
  });

  it("refuses a new file with an old-style name on a baselined database", async () => {
    const db = await scratchDatabase();
    await db.query("create table projects (id int primary key)");
    const dir = await migrationsDir({ "2026-10-old.sql": "select 1;" });
    await baseline({ url: db.url, dir });
    await writeFile(join(dir, "2026-12-new-thing.sql"), "create table new_thing (id int);");

    await expect(migrate({ url: db.url, dir })).rejects.toThrow(/2026-12-new-thing\.sql is new but has an old-style name/);
    expect(await db.tables()).not.toContain("new_thing");
  });

  it("refuses a name in neither format", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({ "add-things.sql": "create table things (id int);" });

    await expect(migrate({ url: db.url, dir })).rejects.toThrow("add-things.sql is not a valid name");
    expect(await db.tables()).toEqual([]);
  });
});

describe("baseline", () => {
  it("records every file as applied without running any", async () => {
    const db = await scratchDatabase();
    await db.query("create table projects (id int primary key)");
    const dir = await migrationsDir({
      "2026-09-drops.sql": "drop table projects;",
      "2026-10-creates.sql": "create table never_made (id int);",
    });

    const { recorded } = await baseline({ url: db.url, dir });

    expect(recorded).toEqual(["2026-09-drops.sql", "2026-10-creates.sql"]);
    expect(await db.tables()).toEqual(["projects", "schema_migrations"]);
    expect(await records(db)).toEqual([
      { filename: "2026-09-drops.sql", checksum: sha256("drop table projects;"), baseline: true },
      { filename: "2026-10-creates.sql", checksum: sha256("create table never_made (id int);"), baseline: true },
    ]);

    // From here on migrate runs only what is new, and records it as run.
    expect((await migrate({ url: db.url, dir })).applied).toEqual([]);
    await writeFile(join(dir, "2026-11-14-0900-new.sql"), "create table made (id int);");
    expect((await migrate({ url: db.url, dir })).applied).toEqual(["2026-11-14-0900-new.sql"]);
    expect(await db.tables()).toEqual(["made", "projects", "schema_migrations"]);
    expect((await records(db)).map((row) => row.baseline)).toEqual([true, true, false]);
  });

  it("is taken once", async () => {
    const db = await scratchDatabase();
    await db.query("create table projects (id int primary key)");
    const dir = await migrationsDir({ "2026-09-old.sql": "select 1;" });
    await baseline({ url: db.url, dir });
    await writeFile(join(dir, "2026-11-14-0900-new.sql"), "create table made (id int);");

    await expect(baseline({ url: db.url, dir })).rejects.toThrow("the baseline is taken once");
    expect(await records(db)).toHaveLength(1);
  });

  it("refuses an empty database", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir({ "2026-09-old.sql": "select 1;" });

    await expect(baseline({ url: db.url, dir })).rejects.toThrow("has no tables");
    expect(await db.tables()).toEqual([]);
  });

  it("leaves out the files the database does not have yet: they stay pending until applied by hand and recorded", async () => {
    const db = await scratchDatabase();
    await db.query("create table projects (id int primary key)");
    const dir = await migrationsDir({
      "2026-09-old.sql": "drop table projects;",
      "2026-11-not-applied.sql": "create table late (id int);",
    });

    const { recorded } = await baseline({ url: db.url, dir, except: ["2026-11-not-applied.sql"] });

    expect(recorded).toEqual(["2026-09-old.sql"]);
    expect((await migrationStatus({ url: db.url, dir })).pending.map((file) => file.filename)).toEqual(["2026-11-not-applied.sql"]);
    // An old-style name is never run by the runner: it is applied by hand, then recorded by name.
    await expect(migrate({ url: db.url, dir })).rejects.toThrow("old-style name");
    expect(await db.tables()).toEqual(["projects", "schema_migrations"]);
    await db.query("create table late (id int)");
    expect((await baseline({ url: db.url, dir, only: ["2026-11-not-applied.sql"] })).recorded).toEqual(["2026-11-not-applied.sql"]);
    expect((await migrate({ url: db.url, dir })).applied).toEqual([]);

    await expect(baseline({ url: db.url, dir, except: ["nope.sql"] })).rejects.toThrow("No such file");
    await expect(baseline({ url: db.url, dir, only: ["2026-09-old.sql"], except: ["2026-11-not-applied.sql"] })).rejects.toThrow("not both");
  });

  it("records only the named file, for one applied by hand", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);
    await migrate({ url: db.url, dir });
    await writeFile(join(dir, "2026-11-16-1200-by-hand.sql"), "create table by_hand (id int);");
    await writeFile(join(dir, "2026-11-16-1300-other.sql"), "create table other (id int);");

    const { recorded } = await baseline({ url: db.url, dir, only: ["2026-11-16-1200-by-hand.sql"] });

    expect(recorded).toEqual(["2026-11-16-1200-by-hand.sql"]);
    expect((await migrate({ url: db.url, dir })).applied).toEqual(["2026-11-16-1300-other.sql"]);
    expect(await db.tables()).not.toContain("by_hand");
    await expect(baseline({ url: db.url, dir, only: ["2026-11-16-1200-by-hand.sql"] })).rejects.toThrow("Already recorded");
    await expect(baseline({ url: db.url, dir, only: ["nope.sql"] })).rejects.toThrow("No such file");
  });
});

describe("status", () => {
  it("only reads: it creates nothing, and lists records without a file", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);

    const before = await migrationStatus({ url: db.url, dir });
    expect(before.files.map((file) => file.state)).toEqual(["pending", "pending", "pending"]);
    expect(before.problems).toEqual([]);
    expect(await db.tables()).toEqual([]);

    await migrate({ url: db.url, dir });
    // An older checkout (a revert) lacks the newest file: informative, not an error.
    const older = await migrationsDir({
      "2026-11-14-0900-items.sql": CHAIN["2026-11-14-0900-items.sql"],
      "2026-11-14-0901-item-name.sql": CHAIN["2026-11-14-0901-item-name.sql"],
    });
    const after = await migrationStatus({ url: db.url, dir: older });
    expect(after.missing).toEqual(["2026-11-15-0000-first-item.sql"]);
    expect(after.problems).toEqual([]);
    expect((await migrate({ url: db.url, dir: older })).applied).toEqual([]);
  });
});

describe("which database", () => {
  it("prefers MIGRATE_URL, then the direct URL, then the pooled one", () => {
    const all = { MIGRATE_URL: "postgres://m", POSTGRES_URL_NON_POOLING: "postgres://direct", POSTGRES_URL: "postgres://pooled" };
    expect(resolveTarget(all)).toEqual({ url: "postgres://m", source: "MIGRATE_URL" });
    expect(resolveTarget({ ...all, MIGRATE_URL: "" })).toEqual({ url: "postgres://direct", source: "POSTGRES_URL_NON_POOLING" });
    expect(resolveTarget({ POSTGRES_URL: "postgres://pooled" })).toEqual({ url: "postgres://pooled", source: "POSTGRES_URL" });
    expect(resolveTarget({})).toBeNull();
  });

  it("hides connection details in what is printed", () => {
    const redact = redactor("postgres://neon_owner:s3cr3t-pass@ep-cool-name.eu.neon.tech/vitah?sslmode=require");
    const text = redact(
      'password authentication failed for user "neon_owner"; getaddrinfo ENOTFOUND ep-cool-name.eu.neon.tech; ' +
        "postgres://neon_owner:s3cr3t-pass@ep-cool-name.eu.neon.tech/vitah?sslmode=require and postgres://other:pw@host/db",
    );
    expect(text).not.toMatch(/s3cr3t|neon_owner|ep-cool-name|other:pw/);
    expect(text).toContain("password authentication failed");
  });
});

describe("telling a file's own transaction", () => {
  it.each([
    ["BEGIN;\nselect 1;\nCOMMIT;", true],
    ["-- header\n\nbegin ;\nselect 1;\ncommit;", true],
    ["select 1;\nSTART TRANSACTION;\nselect 2;\nCOMMIT;", true],
    ["select 1;\nCOMMIT;", true],
    ["DO $$\nBEGIN\n  PERFORM 1;\nEND $$;", false],
    ["DO $body$ BEGIN PERFORM 1; END $body$;\nselect 2;", false],
    ["-- BEGIN;\n/* BEGIN; /* nested */ COMMIT; */ select 'BEGIN; it''s'; select E'\\'; BEGIN;';", false],
    ['select 1 as "x;BEGIN";', false],
    // The body of a SQL-standard function, and going back to a savepoint, are no transaction control.
    ["create function f() returns int language sql BEGIN ATOMIC select 1; END;", false],
    ["create function f() returns int language sql BEGIN ATOMIC select 1; END;\nCOMMIT;", true],
    ["savepoint a; rollback to a;", false],
    ["", false],
  ])("%j → %s", (sql, expected) => {
    expect(hasOwnTransaction(sql)).toBe(expected);
  });

  it("says which keyword and where", () => {
    expect(transactionControl("select 1;\n\n  Start\n  Transaction;")).toEqual({ keyword: "START TRANSACTION", line: 3 });
    expect(transactionControl("select 1;")).toBeNull();
  });

  it("splits a file into its statements, each where it starts", () => {
    const sql = "-- header; not a statement\ncreate table a (note text default 'x;y');\n\nDO $$ BEGIN PERFORM 1; END $$;\ncreate function f() returns int language sql BEGIN ATOMIC select 1; select 2; END;\n;\nselect 1 -- no semicolon";

    const statements = splitStatements(sql);

    expect(statements.map((statement) => statement.text.trim().split("\n").at(-1))).toEqual([
      "create table a (note text default 'x;y')",
      "DO $$ BEGIN PERFORM 1; END $$",
      "create function f() returns int language sql BEGIN ATOMIC select 1; select 2; END",
      "select 1 -- no semicolon",
    ]);
    for (const statement of statements) expect(sql.slice(statement.start, statement.start + statement.text.length)).toBe(statement.text);
  });

  it.each([
    ["-- migrate: no-transaction\ncreate index concurrently i on t (id);", true],
    ["--migrate:no-transaction  \r\nselect 1;", true],
    ["\n-- migrate: no-transaction\nselect 1;", false],
    ["-- about migrate: no-transaction\nselect 1;", false],
    ["select 1; -- migrate: no-transaction", false],
    ["", false],
  ])("a file is marked no-transaction only by its first line: %j → %s", (sql, expected) => {
    expect(declaresNoTransaction(sql)).toBe(expected);
  });
});

describe("a pooled connection", () => {
  // Never reached: the refusal comes before any connection.
  const POOLED = "postgres://owner:s3cr3t-pass@ep-cool-name-pooler.eu-central-1.aws.neon.tech/vitah?sslmode=require";

  it.each([
    [POOLED, true],
    ["postgres://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres", true],
    ["postgres://u:p@db.example.com:6432/app?pgbouncer=true", true],
    ["postgres://owner:pw@ep-cool-name.eu-central-1.aws.neon.tech/vitah?sslmode=require", false],
    ["postgres://vitah:vitah_dev@localhost:4432/vitah", false],
    ["postgres://u:p@carpooler.example.com/app", false],
    ["not a url", false],
  ])("%s looks pooled: %s", (url, expected) => {
    expect(looksPooled(url)).toBe(expected);
  });

  it("is refused by migrate and baseline before anything is run, without giving the URL away", async () => {
    const dir = await migrationsDir(CHAIN);
    const started = Date.now();

    const errors = [
      await migrate({ url: POOLED, dir }).catch((e: unknown) => e),
      await baseline({ url: POOLED, dir }).catch((e: unknown) => e),
      await baseline({ url: POOLED, dir, only: ["2026-11-14-0900-items.sql"] }).catch((e: unknown) => e),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      const { message } = error as Error;
      expect(message).toMatch(/is a pooled connection, and migrations need a direct one.*Nothing was run.*POSTGRES_URL_NON_POOLING/s);
      expect(message).not.toMatch(/s3cr3t|ep-cool-name|neon/);
    }
    // No connection was attempted (the host doesn't exist: that would take its time, or fail differently).
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("fails a production deploy whose only URL is the pooled one, and uses the direct one when there is one", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);
    const production = { VERCEL_ENV: "production", MIGRATE_ON_DEPLOY: "1" };
    const log: string[] = [];

    await expect(deployMigrations({ ...production, POSTGRES_URL: POOLED }, { dir, log: (line) => log.push(line) })).rejects.toThrow(
      /^POSTGRES_URL is a pooled connection.*Nothing was run/s,
    );
    await expect(deployMigrations({ ...production, MIGRATE_URL: POOLED, POSTGRES_URL_NON_POOLING: db.url }, { dir })).rejects.toThrow(
      /^MIGRATE_URL is a pooled connection/,
    );
    // Said before "Migrating…": nothing was started.
    expect(log).toEqual([]);
    expect(await db.tables()).toEqual([]);

    const result = await deployMigrations({ ...production, POSTGRES_URL: POOLED, POSTGRES_URL_NON_POOLING: db.url }, { dir });
    expect(result).toEqual({ applied: Object.keys(CHAIN) });
  });

  it("as a command: migrate and baseline exit non-zero naming the variable, status is not refused", async () => {
    const dir = await migrationsDir(CHAIN);

    for (const command of ["migrate", "baseline"]) {
      const refused = await run(command, { POSTGRES_URL: POOLED, MIGRATIONS_DIR: dir });
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain("POSTGRES_URL is a pooled connection");
      expect(refused.stdout + refused.stderr).not.toMatch(/s3cr3t|ep-cool-name/);
    }

    // `status` only reads: it goes on to connect (here to a pooler-looking name for this machine, if it resolves).
    const local = new URL((await scratchDatabase()).url);
    local.hostname = "db-pooler.localhost";
    expect(looksPooled(local.toString())).toBe(true);
    const status = await run("status", { MIGRATE_URL: local.toString(), MIGRATIONS_DIR: dir });
    expect(status.stdout + status.stderr).not.toContain("pooled connection");
    if (status.code === 0) expect(status.stdout).toContain("0 applied, 3 pending, 0 changed.");
  });
});

// --- The deploy hook -----------------------------------------------------------

const run = (command: string, env: Record<string, string>) => runCli("migrate-cli.ts", [command], env);

describe("the deploy hook (db:sql:deploy)", () => {
  it("does nothing unless VERCEL_ENV is production", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);
    const urls = { MIGRATE_URL: db.url, POSTGRES_URL: db.url, POSTGRES_URL_NON_POOLING: db.url };

    for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, { VERCEL_ENV: "" }, { CI: "1" }]) {
      const result = await deployMigrations({ ...urls, ...env }, { dir });
      expect(result).toEqual({ skipped: expect.stringContaining("migrations run only on a production deploy") });
    }
    expect(await db.tables()).toEqual([]);
  });

  it("migrates on a production deploy", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);

    const result = await deployMigrations(
      { VERCEL_ENV: "production", MIGRATE_ON_DEPLOY: "1", POSTGRES_URL_NON_POOLING: db.url },
      { dir },
    );

    expect(result).toEqual({ applied: Object.keys(CHAIN) });
    expect(await db.tables()).toEqual(["items", "schema_migrations"]);
  });

  it("on production without MIGRATE_ON_DEPLOY=1 only says what is pending, and never fails the build", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);
    const production = { VERCEL_ENV: "production", POSTGRES_URL_NON_POOLING: db.url };

    for (const env of [production, { ...production, MIGRATE_ON_DEPLOY: "0" }, { ...production, MIGRATE_ON_DEPLOY: "true" }]) {
      expect(await deployMigrations(env, { dir })).toEqual({
        skipped: `MIGRATE_ON_DEPLOY is not "1" (automatic migrations are off for production; ${Object.keys(CHAIN).length} files pending)`,
      });
    }
    expect(await db.tables()).toEqual([]);
    // No database to ask, or one that can't be read: still a skip, not a failure.
    expect(await deployMigrations({ VERCEL_ENV: "production" }, { dir })).toEqual({
      skipped: expect.stringContaining("pending files unknown"),
    });
    expect(
      await deployMigrations({ VERCEL_ENV: "production", POSTGRES_URL: "postgres://nobody:x@127.0.0.1:1/none" }, { dir }),
    ).toEqual({ skipped: expect.stringContaining("could not read the migration record") });
  });

  it("fails a production deploy that has no database URL", async () => {
    const dir = await migrationsDir(CHAIN);
    await expect(deployMigrations({ VERCEL_ENV: "production", MIGRATE_ON_DEPLOY: "1" }, { dir })).rejects.toThrow(
      "without a database URL",
    );
  });

  it("as a command: one line and exit 0 when skipped, the database untouched", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);

    const skipped: Record<string, string>[] = [{}, { VERCEL_ENV: "preview" }];
    for (const env of skipped) {
      const result = await run("deploy", { ...env, MIGRATE_URL: db.url, POSTGRES_URL: db.url, MIGRATIONS_DIR: dir });
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim().split("\n")).toEqual([expect.stringMatching(/^db:sql:deploy skipped: VERCEL_ENV is .+ \(migrations run only on a production deploy\)\.$/)]);
    }
    // Skipped without a database at all, as in CI.
    expect((await run("deploy", { MIGRATIONS_DIR: dir })).code).toBe(0);
    expect(await db.tables()).toEqual([]);
  });

  it("as a command: applies on production, and exits non-zero when a file fails", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);
    const env = { VERCEL_ENV: "production", MIGRATE_ON_DEPLOY: "1", MIGRATE_URL: db.url, MIGRATIONS_DIR: dir };

    const ok = await run("deploy", env);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("applied   2026-11-15-0000-first-item.sql");
    expect(await db.tables()).toEqual(["items", "schema_migrations"]);

    await writeFile(join(dir, "2026-11-16-1200-broken.sql"), "select * from no_such_table;");
    const failed = await run("deploy", env);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("2026-11-16-1200-broken.sql failed");
    // Nothing it prints gives the database away.
    const password = new URL(db.url).password;
    for (const output of [ok.stdout, ok.stderr, failed.stdout, failed.stderr]) {
      expect(output).not.toContain(db.url);
      expect(output).not.toContain(password);
    }
  });

  it("as a command: status exits non-zero on a changed file, and on a database it cannot reach", async () => {
    const db = await scratchDatabase();
    const dir = await migrationsDir(CHAIN);
    await migrate({ url: db.url, dir });
    expect((await run("status", { MIGRATE_URL: db.url, MIGRATIONS_DIR: dir })).code).toBe(0);

    await writeFile(join(dir, "2026-11-14-0900-items.sql"), "create table items (id bigint primary key);");
    const changed = await run("status", { MIGRATE_URL: db.url, MIGRATIONS_DIR: dir });
    expect(changed.code).toBe(1);
    expect(changed.stdout).toMatch(/^CHANGED\s+2026-11-14-0900-items\.sql/m);

    const wrong = db.url.replace(/:[^:@/]+@/, ":wrong-password-123@");
    const unreachable = await run("status", { MIGRATE_URL: wrong, MIGRATIONS_DIR: dir });
    expect(unreachable.code).toBe(1);
    expect(unreachable.stdout + unreachable.stderr).not.toContain("wrong-password-123");
  });
});
