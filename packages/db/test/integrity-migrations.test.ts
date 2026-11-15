// The production SQL files take a database in the schema from before them
// (test/fixtures/schema-before-2026-11-15.sql) to exactly what schema.ts
// builds, through the real runner, also when production's key names differ,
// when every one of them runs twice, and when existing rows break a new constraint.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { packageRoot, pushSchema } from "../src/ops/connection";
import { compareSnapshots, introspect, type DriftItem, type Snapshot } from "../src/ops/drift";
import { baseline, compareNames, migrate } from "../src/ops/migrate";
import { transactionControl } from "../src/ops/sql-scan";
import { dropScratch, resetScratch, scratchDatabase, type Scratch } from "./scratch";
import { tenantTree } from "./tree";

const SQL_DIR = join(packageRoot, "sql");
const FIXTURE = join(packageRoot, "test/fixtures/schema-before-2026-11-15.sql");
// The last file the fixture's schema has: every one after it is applied here.
const LAST_IN_FIXTURE = "2026-11-14-1710-user-mfa.sql";
const INTEGRITY = [
  "2026-11-15-1000-check-constraints.sql",
  "2026-11-15-1010-tenant-composite-keys.sql",
  "2026-11-15-1020-project-fk-no-cascade.sql",
];

let expected: Snapshot;
let newer: string[];

beforeAll(async () => {
  const fromSchema = await scratchDatabase();
  pushSchema(fromSchema.url);
  expected = await introspect(fromSchema.url);
  await resetScratch();
  newer = (await readdir(SQL_DIR))
    .filter((name) => name.endsWith(".sql") && compareNames(name, LAST_IN_FIXTURE) > 0)
    .sort(compareNames);
}, 120_000);
afterEach(resetScratch);
afterAll(dropScratch);

/** A database as production was before these files: the fixture, every older file recorded (baseline). */
async function before(setup = ""): Promise<Scratch> {
  const db = await scratchDatabase();
  await db.query(await readFile(FIXTURE, "utf8"));
  if (setup) await db.query(setup);
  await baseline({ url: db.url, dir: SQL_DIR, except: newer });
  return db;
}

/** Applies the pending files with the runner → what it logged (the files' notices included). */
async function migrated(db: Scratch): Promise<string[]> {
  const log: string[] = [];
  const { applied } = await migrate({ url: db.url, dir: SQL_DIR, log: (line) => log.push(line) });
  expect(applied).toEqual(newer);
  return log;
}

const drift = async (db: Scratch) =>
  compareSnapshots(expected, await introspect(db.url)).map((item: DriftItem) => `${item.group}: ${item.item} — ${item.detail}`);

describe("the integrity migrations", () => {
  it("are new files the runner takes: after the fixture, no transaction control of their own", async () => {
    expect(newer).toEqual(expect.arrayContaining(INTEGRITY));
    for (const name of newer) expect(transactionControl(await readFile(join(SQL_DIR, name), "utf8")), name).toBeNull();
  });

  it("take the schema from before them to exactly what schema.ts builds", async () => {
    const db = await before();
    const log = await migrated(db);
    expect(await drift(db)).toEqual([]);
    expect(log.filter((line) => line.includes("NOT VALID"))).toEqual([]);
  });

  it("find production's keys by what they are, whatever their names, and can run again by hand", async () => {
    // Production's foreign keys and unique constraints are not named as Drizzle names them.
    const db = await before(`
      DO $$
      DECLARE k record;
      BEGIN
        FOR k IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
                 WHERE contype = 'f' AND connamespace = 'public'::regnamespace LOOP
          EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', k.tbl, k.conname, 'legacy_' || md5(k.conname));
        END LOOP;
      END $$;`);
    await migrated(db);
    expect(await drift(db)).toEqual([]);
    // No key renamed above survives as a second copy of one the files replaced.
    expect(await db.query("select count(*)::int as n from pg_constraint where conname like 'legacy_%' and confrelid = 'projects'::regclass")).toEqual([
      { n: 1 }, // ai_usage.project_id: ON DELETE SET NULL, kept as it was.
    ]);

    // Every file after the fixture, once more: each says it is safe to run twice.
    for (const name of newer) await db.query(await readFile(join(SQL_DIR, name), "utf8"));
    expect(await drift(db)).toEqual([]);
  });

  it("leave a constraint that existing rows break NOT VALID, say so, and still check every new write", async () => {
    const db = await before(
      tenantTree("a", { fixtureOnly: true }) +
        tenantTree("b", { fixtureOnly: true }) +
        // Legacy rows the new constraints would refuse: a stage out of range, and a document under another tenant's project.
        "update projects set obra_stage = 9 where id = 'project_a';" +
        "update project_documents set project_id = 'project_b' where id = 'document_a';",
    );
    const log = await migrated(db);

    expect(log.filter((line) => line.includes("NOT VALID")).map((line) => line.replace(/^.*NOT VALID: (\S+) on (\S+).*$/, "$1 on $2"))).toEqual([
      "projects_obra_stage_check on projects",
      // Once only: the keys to projects are created without their cascade, so the next file leaves them alone.
      "project_documents_project_id_tenant_fk on project_documents",
    ]);
    expect(await db.query("select conname from pg_constraint where not convalidated and connamespace = 'public'::regnamespace order by 1")).toEqual([
      { conname: "project_documents_project_id_tenant_fk" },
      { conname: "projects_obra_stage_check" },
    ]);
    // The drift check says so, with what to do.
    expect(await drift(db)).toEqual([
      "different: foreign key project_documents(tenant_id, project_id) -> projects(tenant_id, id) — NOT VALID: the rows from before it " +
        "was added were never checked. Fix those that break it, then ALTER TABLE project_documents VALIDATE CONSTRAINT project_documents_project_id_tenant_fk",
      "different: constraint projects.projects_obra_stage_check — NOT VALID: the rows from before it was added were never checked. " +
        "Fix those that break it, then ALTER TABLE projects VALIDATE CONSTRAINT projects_obra_stage_check",
    ]);

    // New writes are checked all the same, and a project still can't be erased.
    await expect(db.query("update projects set obra_stage = 0 where id = 'project_b'")).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("update project_documents set project_id = 'project_a' where id = 'document_b'")).rejects.toMatchObject({ code: "23503" });
    await expect(db.query("delete from projects where id = 'project_b'")).rejects.toMatchObject({ code: "23503" });

    // Once the rows are fixed, validating makes it whole: no drift left.
    await db.query(`
      update projects set obra_stage = 8 where id = 'project_a';
      update project_documents set project_id = 'project_a' where id = 'document_a';
      alter table projects validate constraint projects_obra_stage_check;
      alter table project_documents validate constraint project_documents_project_id_tenant_fk;`);
    expect(await drift(db)).toEqual([]);
  });
});
