// Scratch databases for the tests of the migration runner and the drift
// check: each one is created empty on the test Postgres and dropped after.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createScratchDatabase, packageRoot } from "../src/ops/connection";

export const SERVER_URL = process.env.TEST_POSTGRES_URL ?? "postgres://vitah:vitah_dev@localhost:4432";

// Named after this checkout, so worktrees sharing one Postgres only ever
// clean up their own leftovers (see global-setup.ts).
const checkout = createHash("sha256")
  .update(fileURLToPath(new URL("../../..", import.meta.url)))
  .digest("hex")
  .slice(0, 8);
export const SCRATCH_PREFIX = `vitah_db_test_${checkout}`;

export type Scratch = {
  url: string;
  /** Runs SQL (several statements at once is fine) and returns the last result's rows. */
  query: <T extends Record<string, unknown> = Record<string, unknown>>(text: string) => Promise<T[]>;
  tables: () => Promise<string[]>;
};

// A test file keeps its databases and empties them between tests: creating
// and dropping one per test forces a checkpoint each time, which stalls the
// other packages' suites running beside this one on the same Postgres.
const databases: { scratch: Scratch; close: () => Promise<void> }[] = [];
let inUse = 0;
const folders: string[] = [];

/** An empty database of its own for this test. */
export async function scratchDatabase(): Promise<Scratch> {
  const ready = databases[inUse++];
  if (ready) return ready.scratch;

  const database = await createScratchDatabase(SERVER_URL, SCRATCH_PREFIX);
  const sql = postgres(database.url, { max: 1, onnotice: () => {} });
  const query: Scratch["query"] = async (text) => [...(await sql.unsafe(text))] as never;
  const scratch: Scratch = {
    url: database.url,
    query,
    tables: async () =>
      (await query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public' order by 1")).map(
        (row) => row.tablename,
      ),
  };
  databases.push({
    scratch,
    close: async () => {
      await sql.end();
      await database.drop();
    },
  });
  return scratch;
}

/** A temporary folder holding the given migration files. */
export async function migrationsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vitah-migrations-"));
  folders.push(dir);
  for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql);
  return dir;
}

/** Call from `afterEach`: empties the databases the test used and removes its folders. */
export async function resetScratch(): Promise<void> {
  for (const { scratch } of databases.slice(0, inUse)) {
    await scratch.query("drop schema public cascade; create schema public;");
  }
  inUse = 0;
  for (const dir of folders.splice(0)) await rm(dir, { recursive: true, force: true });
}

/** Call from `afterAll`: drops the file's databases. */
export async function dropScratch(): Promise<void> {
  for (const database of databases.splice(0)) await database.close();
}

/** Runs one of the real command lines (`src/ops/<script>`), with only the environment given. */
export function runCli(
  script: "migrate-cli.ts" | "drift-cli.ts",
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(
      resolve(packageRoot, "node_modules/.bin/tsx"),
      [resolve(packageRoot, "src/ops", script), ...args],
      { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } },
      (error, stdout, stderr) => done({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}
