// The migration runner: applies the SQL files of `packages/db/sql` to a
// database, once each, and records them in `schema_migrations`. The rules the
// files follow are in `packages/db/sql/README.md`.
//
// It talks to the database with its own `postgres` connection (never the
// shared `db` client), so it can take any URL, and it never prints that URL.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import {
  NO_TRANSACTION_DIRECTIVE,
  declaresNoTransaction,
  hasOwnTransaction,
  splitStatements,
  transactionControl,
} from "./sql-scan";

/** New files: `YYYY-MM-DD-HHmm-topic.sql`, the time in UTC. */
const TIMESTAMPED_NAME =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])-(?:[01]\d|2[0-3])[0-5]\d-[a-z0-9]+(?:-[a-z0-9]+)*\.sql$/;
/** The files written before the runner: `YYYY-MM-topic.sql`. */
const LEGACY_NAME = /^\d{4}-(?:0[1-9]|1[0-2])-[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.sql$/;

export const NAME_RULE = "YYYY-MM-DD-HHmm-topic.sql (UTC), e.g. 2026-11-14-0930-add-invoice-notes.sql";

/** Session-level advisory lock held for a whole run: two runs never overlap. */
const LOCK_KEY = "7304117502";

export type MigrationFile = { filename: string; checksum: string; sql: string };
export type MigrationRecord = { filename: string; checksum: string; appliedAt: Date; baseline: boolean };
export type FileStatus = {
  filename: string;
  state: "applied" | "pending" | "changed";
  /** Recorded by `baseline`, not run by the runner. */
  baseline: boolean;
  appliedAt: Date | null;
};
export type MigrationPlan = {
  files: FileStatus[];
  pending: MigrationFile[];
  /** Recorded as applied but not in this checkout (an older commit, a revert). Informative only. */
  missing: string[];
  /** Why `migrate` refuses. Empty when everything is in order. */
  problems: string[];
};

export type RunOptions = {
  url: string;
  dir: string;
  log?: (line: string) => void;
  /** How long to wait for another run to finish. Default 10 minutes. */
  lockTimeoutMs?: number;
};

export class MigrationError extends Error {}

/** A file failed: `applied` went in before it, `pending` were not tried. */
export class MigrationFailed extends MigrationError {
  constructor(
    message: string,
    readonly failed: string,
    readonly applied: string[],
    readonly pending: string[],
  ) {
    super(message);
  }
}

const isValidName = (name: string) => TIMESTAMPED_NAME.test(name) || LEGACY_NAME.test(name);

/**
 * The order files are applied in. The legacy names only say the month, so
 * they all go first (they predate every timestamped file); within each
 * group, by name.
 */
export function compareNames(a: string, b: string): number {
  const group = Number(TIMESTAMPED_NAME.test(a)) - Number(TIMESTAMPED_NAME.test(b));
  if (group !== 0) return group;
  return a < b ? -1 : a > b ? 1 : 0;
}

export async function readMigrationFiles(dir: string): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort(compareNames);
  return Promise.all(
    names.map(async (filename) => {
      const bytes = await readFile(join(dir, filename));
      return { filename, checksum: createHash("sha256").update(bytes).digest("hex"), sql: bytes.toString("utf8") };
    }),
  );
}

/** What is applied, what is pending, and whether it is safe to go on. Pure. */
export function planMigrations(
  files: MigrationFile[],
  records: MigrationRecord[],
  /** A table of the database that isn't `schema_migrations`, if it has any. */
  applicationTable: string | null,
): MigrationPlan {
  const recorded = new Map(records.map((record) => [record.filename, record]));
  const problems: string[] = [];
  const pending: MigrationFile[] = [];

  const statuses = files.map((file): FileStatus => {
    const record = recorded.get(file.filename);
    if (!record) {
      pending.push(file);
      return { filename: file.filename, state: "pending", baseline: false, appliedAt: null };
    }
    const changed = record.checksum !== file.checksum;
    if (changed) {
      problems.push(
        `${file.filename} changed after it was applied (recorded sha256 ${record.checksum.slice(0, 12)}…, the file is ` +
          `${file.checksum.slice(0, 12)}…). Applied files are immutable: restore it and put the change in a new file.`,
      );
    }
    return {
      filename: file.filename,
      state: changed ? "changed" : "applied",
      baseline: record.baseline,
      appliedAt: record.appliedAt,
    };
  });

  for (const file of files) {
    if (!isValidName(file.filename)) {
      problems.push(`${file.filename} is not a valid name. New files are named ${NAME_RULE}.`);
    }
  }

  if (records.length === 0 && applicationTable !== null && pending.length > 0) {
    problems.push(
      `The database already has tables (e.g. "${applicationTable}") but no migration is recorded, and the files ` +
        `are not safe to run again. Record what it already has first: db:sql:baseline.`,
    );
  }

  // A new file runs in one transaction with its record, so it can't open or
  // end one itself; the one that can't run in a transaction says so.
  for (const file of pending) {
    if (!TIMESTAMPED_NAME.test(file.filename) || declaresNoTransaction(file.sql)) continue;
    const control = transactionControl(file.sql);
    if (control) {
      problems.push(
        `${file.filename} has transaction control of its own (${control.keyword} at line ${control.line}). A file runs ` +
          `in one transaction together with its record: remove it. If the file cannot run in a transaction (CREATE ` +
          `INDEX CONCURRENTLY), make "${NO_TRANSACTION_DIRECTIVE}" its first line, and the file safe to run twice.`,
      );
    }
  }

  const baselined = records.some((record) => record.baseline);
  const lastRun = records
    .filter((record) => !record.baseline)
    .map((record) => record.filename)
    .sort(compareNames)
    .at(-1);
  for (const file of pending) {
    if (baselined && LEGACY_NAME.test(file.filename)) {
      problems.push(`${file.filename} is new but has an old-style name. Rename it to ${NAME_RULE}.`);
    } else if (lastRun !== undefined && compareNames(file.filename, lastRun) < 0) {
      problems.push(
        `${file.filename} is pending but sorts before ${lastRun}, which is already applied. Files run in name ` +
          `order: rename it with the current UTC date and time.`,
      );
    }
  }

  const present = new Set(files.map((file) => file.filename));
  const missing = records
    .map((record) => record.filename)
    .filter((name) => !present.has(name))
    .sort(compareNames);

  return { files: statuses, pending, missing, problems };
}

// --- The database side -------------------------------------------------------

type Session = postgres.ReservedSql;
type Notices = { sink: ((line: string) => void) | null };

async function withSession<T>(url: string, run: (session: Session, notices: Notices) => Promise<T>): Promise<T> {
  const notices: Notices = { sink: null };
  const sql = postgres(url, {
    // One connection: the advisory lock and the transactions live in its session.
    max: 1,
    // `status` only reads, and may do so through a pooler (a run may not: `assertDirect`).
    prepare: false,
    connect_timeout: 30,
    onnotice: (notice) => notices.sink?.(`  ${String(notice.severity ?? "notice").toLowerCase()}: ${notice.message}`),
  });
  try {
    const session = await sql.reserve();
    try {
      return await run(session, notices);
    } finally {
      session.release();
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function withLock<T>(
  options: RunOptions,
  run: (session: Session, notices: Notices, assertLocked: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const log = options.log ?? (() => {});
  // Before connecting: through a pooler the lock below would guard nothing.
  assertDirect(options.url);
  return withSession(options.url, async (session, notices) => {
    const deadline = Date.now() + (options.lockTimeoutMs ?? 10 * 60_000);
    let waiting = false;
    for (;;) {
      const [row] = await session<{ locked: boolean }[]>`select pg_try_advisory_lock(${LOCK_KEY}::bigint) as locked`;
      if (row?.locked) break;
      if (Date.now() >= deadline) {
        throw new MigrationError("Another migration run still holds the lock on this database. Nothing was done.");
      }
      if (!waiting) log("Another migration run is in progress on this database: waiting for it to finish.");
      waiting = true;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const pid = await backendPid(session);
    try {
      return await run(session, notices, async () => {
        // A session lock dies with its connection. Should the driver have
        // reconnected (or a pooler handed us another backend), we no longer
        // hold it: stop rather than run unguarded.
        if ((await backendPid(session)) !== pid) {
          throw new MigrationError(
            "The database session changed and with it the migration lock was lost. Run it again, on a direct " +
              "(not pooled) connection.",
          );
        }
      });
    } finally {
      await session`select pg_advisory_unlock(${LOCK_KEY}::bigint)`.catch(() => {});
    }
  });
}

async function backendPid(session: Session): Promise<number> {
  const [row] = await session<{ pid: number }[]>`select pg_backend_pid() as pid`;
  return row!.pid;
}

type Loaded = { plan: MigrationPlan; files: MigrationFile[]; recorded: number; applicationTable: string | null };

async function loadPlan(session: Session, dir: string): Promise<Loaded> {
  const files = await readMigrationFiles(dir);
  const [table] = await session<{ present: boolean }[]>`
    select to_regclass('public.schema_migrations') is not null as present`;
  const records = table?.present
    ? await session<MigrationRecord[]>`
        select filename, checksum, applied_at as "appliedAt", baseline from public.schema_migrations`
    : [];
  const [other] = await session<{ tablename: string }[]>`
    select tablename from pg_catalog.pg_tables
    where schemaname = 'public' and tablename <> 'schema_migrations'
    order by (tablename = 'projects') desc, tablename
    limit 1`;
  const applicationTable = other?.tablename ?? null;
  return { plan: planMigrations(files, [...records], applicationTable), files, recorded: records.length, applicationTable };
}

async function ensureTable(session: Session): Promise<void> {
  await session.unsafe(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now(),
      baseline boolean not null default false
    )`);
}

function record(session: Session, file: MigrationFile, baseline: boolean) {
  return session`
    insert into public.schema_migrations (filename, checksum, baseline)
    values (${file.filename}, ${file.checksum}, ${baseline})`;
}

/** Whether the session sits inside an open transaction block. */
async function inTransaction(session: Session): Promise<boolean> {
  // Outside a block each statement is its own transaction, with its own id.
  const [first] = await session.unsafe("select txid_current()::text as id");
  const [second] = await session.unsafe("select txid_current()::text as id");
  return first?.id === second?.id;
}

/** `offset`: where in the file the text that was sent starts (a file sent whole: 0). */
function describeFailure(file: MigrationFile, error: unknown, offset = 0): string {
  if (!(error instanceof Error)) return `${file.filename} failed: ${String(error)}`;
  const pg = error as Error & { position?: string; detail?: string; hint?: string; where?: string };
  const position = Number(pg.position);
  const line =
    Number.isInteger(position) && position > 0 ? file.sql.slice(0, offset + position - 1).split("\n").length : null;
  return [
    `${file.filename} failed${line === null ? "" : ` at line ${line}`}: ${error.message}`,
    pg.detail && `  detail: ${pg.detail}`,
    pg.hint && `  hint: ${pg.hint}`,
    pg.where && `  where: ${pg.where}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Fails a file that left a transaction open in the session, after rolling it back. */
async function assertNoOpenTransaction(session: Session, file: MigrationFile): Promise<void> {
  if (!(await inTransaction(session))) return;
  await session.unsafe("ROLLBACK");
  throw new MigrationError(
    `${file.filename} failed: it left a transaction open (a BEGIN without its COMMIT), which was rolled back.`,
  );
}

/**
 * Runs one file and records it.
 *
 * A new file (`YYYY-MM-DD-HHmm-topic.sql`) goes in ONE transaction with its
 * record: all of it and the record, or nothing. It has no transaction control
 * of its own (`planMigrations` refuses one that does). The exception says so
 * on its first line (`-- migrate: no-transaction`): its statements are sent
 * one by one, as written, outside any transaction (so `CREATE INDEX
 * CONCURRENTLY` works), and it is recorded afterwards. Should the run die
 * between the two it is run again: such a file must be safe to run twice.
 *
 * A legacy file (`YYYY-MM-topic.sql`, only ever baselined on a real database)
 * keeps what it always had: with its own `BEGIN`/`COMMIT` it is sent whole,
 * as written, and recorded right after; without, it is wrapped like a new one.
 */
async function applyFile(session: Session, file: MigrationFile): Promise<void> {
  const timestamped = TIMESTAMPED_NAME.test(file.filename);
  if (timestamped && declaresNoTransaction(file.sql)) {
    for (const statement of splitStatements(file.sql)) {
      try {
        await session.unsafe(statement.text);
      } catch (error) {
        // Only if the file had opened a transaction itself (an aborted one refuses even the question).
        if (await inTransaction(session).catch(() => true)) await session.unsafe("ROLLBACK").catch(() => {});
        throw new MigrationError(
          `${describeFailure(file, error, statement.start)}\n  The file runs outside a transaction ` +
            `(${NO_TRANSACTION_DIRECTIVE}): what its earlier statements did stays, and it is not recorded.`,
        );
      }
    }
    await assertNoOpenTransaction(session, file);
    await record(session, file, false);
  } else if (!timestamped && hasOwnTransaction(file.sql)) {
    try {
      await session.unsafe(file.sql);
    } catch (error) {
      await session.unsafe("ROLLBACK").catch(() => {});
      throw new MigrationError(describeFailure(file, error));
    }
    await assertNoOpenTransaction(session, file);
    await record(session, file, false);
  } else {
    await session.unsafe("BEGIN");
    try {
      await session.unsafe(file.sql);
      await record(session, file, false);
      await session.unsafe("COMMIT");
    } catch (error) {
      await session.unsafe("ROLLBACK").catch(() => {});
      throw new MigrationError(describeFailure(file, error));
    }
  }
  // A `SET` in one file must not leak into the next.
  await session.unsafe("RESET ALL");
}

function refuse(problems: string[]): MigrationError {
  return new MigrationError(["Refusing to migrate:", ...problems.map((problem) => `  - ${problem}`)].join("\n"));
}

/** Every file as applied / pending / changed. Reads only; creates nothing. */
export async function migrationStatus(options: Pick<RunOptions, "url" | "dir">): Promise<MigrationPlan> {
  return withSession(options.url, async (session) => {
    return (await loadPlan(session, options.dir)).plan;
  });
}

/** Applies the pending files in order, each followed by its record, stopping at the first failure. */
export async function migrate(options: RunOptions): Promise<{ applied: string[] }> {
  const log = options.log ?? (() => {});
  return withLock(options, async (session, notices, assertLocked) => {
    const { plan } = await loadPlan(session, options.dir);
    if (plan.problems.length > 0) throw refuse(plan.problems);
    if (plan.pending.length === 0) {
      log(`Nothing to apply: all ${plan.files.length} files are recorded.`);
      return { applied: [] };
    }

    await ensureTable(session);
    const applied: string[] = [];
    for (const [index, file] of plan.pending.entries()) {
      await assertLocked();
      const started = Date.now();
      notices.sink = log;
      try {
        await applyFile(session, file);
      } catch (error) {
        const pending = plan.pending.slice(index + 1).map((next) => next.filename);
        const rest = pending.length > 0 ? `\nNot applied: ${pending.join(", ")}` : "";
        throw new MigrationFailed(`${(error as Error).message}${rest}`, file.filename, applied, pending);
      } finally {
        notices.sink = null;
      }
      applied.push(file.filename);
      log(`applied   ${file.filename} (${Date.now() - started} ms)`);
    }
    log(`Applied ${applied.length} file${applied.length === 1 ? "" : "s"}.`);
    return { applied };
  });
}

/**
 * Records files as applied WITHOUT running them, for a database that already
 * has what they do (production, the day the runner arrives). With no names:
 * every file, once, on a database that has tables and no record yet, less
 * those in `except` (files the database does NOT have yet: they stay pending).
 * With names: just those, e.g. a file applied by hand.
 */
export async function baseline(
  options: RunOptions & { only?: string[]; except?: string[] },
): Promise<{ recorded: string[] }> {
  const log = options.log ?? (() => {});
  const only = options.only ?? [];
  const except = options.except ?? [];
  return withLock(options, async (session) => {
    const { plan, files: all, recorded, applicationTable } = await loadPlan(session, options.dir);
    const invalid = all.filter((file) => !isValidName(file.filename)).map((file) => file.filename);
    if (invalid.length > 0) {
      throw new MigrationError(`Not a valid name: ${invalid.join(", ")}. New files are named ${NAME_RULE}.`);
    }

    let files: MigrationFile[];
    const unknown = [...only, ...except].filter((name) => !all.some((file) => file.filename === name));
    if (unknown.length > 0) throw new MigrationError(`No such file in the migrations folder: ${unknown.join(", ")}`);
    if (only.length > 0) {
      if (except.length > 0) throw new MigrationError("Name the files to record, or the ones to leave out, not both.");
      const done = only.filter((name) => !plan.pending.some((file) => file.filename === name));
      if (done.length > 0) throw new MigrationError(`Already recorded: ${done.join(", ")}`);
      files = plan.pending.filter((file) => only.includes(file.filename));
    } else {
      if (recorded > 0) {
        throw new MigrationError(
          `This database already has ${recorded} recorded migration${recorded === 1 ? "" : "s"}: the baseline is ` +
            `taken once. To record a single file that was applied by hand, name it: db:sql:baseline -- <file.sql>`,
        );
      }
      if (applicationTable === null) {
        throw new MigrationError(
          "This database has no tables: there is nothing to baseline. Is it the right database? " +
            "(An empty one is built with db:push, not from these files.)",
        );
      }
      files = plan.pending.filter((file) => !except.includes(file.filename));
    }

    await ensureTable(session);
    await session.unsafe("BEGIN");
    try {
      for (const file of files) await record(session, file, true);
      await session.unsafe("COMMIT");
    } catch (error) {
      await session.unsafe("ROLLBACK").catch(() => {});
      throw error;
    }
    for (const file of files) log(`recorded  ${file.filename}`);
    log(`Recorded ${files.length} file${files.length === 1 ? "" : "s"} as applied, without running anything.`);
    for (const name of except) log(`pending   ${name} (left out: not recorded)`);
    return { recorded: files.map((file) => file.filename) };
  });
}

// --- Which database, and the deploy hook ---------------------------------------

type Env = Record<string, string | undefined>;

/**
 * `MIGRATE_URL`, else the direct URL Vercel provides, else the pooled one
 * (which only `status` accepts: see `assertDirect`).
 */
export function resolveTarget(env: Env): { url: string; source: string } | null {
  for (const source of ["MIGRATE_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_URL"]) {
    const url = env[source]?.trim();
    if (url) return { url, source };
  }
  return null;
}

/**
 * Whether the URL goes through a connection pooler: Neon names its pooled
 * host `…-pooler` (what Vercel's `POSTGRES_URL` is), Supabase `….pooler.…`,
 * and a PgBouncer URL usually says `pgbouncer=true`.
 */
export function looksPooled(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.includes("-pooler") ||
      parsed.hostname.split(".").includes("pooler") ||
      parsed.searchParams.get("pgbouncer") === "true"
    );
  } catch {
    return false;
  }
}

/**
 * Refuses a pooled connection for anything that writes (`migrate`,
 * `baseline`, the deploy). A run is guarded by a session advisory lock, and a
 * transaction pooler hands each statement to whichever backend is free: the
 * lock would be taken on one and the files run on others, unguarded, with the
 * lock left behind on a backend nobody holds. `status` only reads and may
 * use any URL. `source` names the variable the URL came from; the URL itself
 * is never printed.
 */
export function assertDirect(url: string, source?: string): void {
  if (!looksPooled(url)) return;
  throw new MigrationError(
    `${source ?? "The database URL"} is a pooled connection, and migrations need a direct one (the run lock does ` +
      `not hold through a pooler). Nothing was run. Set POSTGRES_URL_NON_POOLING (Vercel provides it with the ` +
      `database) or MIGRATE_URL to the direct URL.`,
  );
}

/**
 * The step a Vercel build runs before `next build`: migrate, but only on a
 * production deploy that asked for it (`MIGRATE_ON_DEPLOY=1`, set on the
 * Production environment). Preview deployments share production's database,
 * and a local or CI build has no business with it, so everywhere else it does
 * nothing. Without the switch a production build only says how many files are
 * pending: applying them stays a deliberate, manual step. Throws (failing the
 * build) if a migration fails, or if the only URL it has is a pooled one.
 */
export async function deployMigrations(
  env: Env,
  options: Pick<RunOptions, "dir" | "log">,
): Promise<{ skipped: string } | { applied: string[] }> {
  if (env.VERCEL_ENV !== "production") {
    const why = env.VERCEL_ENV ? `VERCEL_ENV is "${env.VERCEL_ENV}"` : "VERCEL_ENV is not set";
    return { skipped: `${why} (migrations run only on a production deploy)` };
  }
  const target = resolveTarget(env);
  if (env.MIGRATE_ON_DEPLOY !== "1") {
    // Never fails the build: this is only a reminder.
    let pending = "pending files unknown";
    if (target) {
      try {
        const plan = await migrationStatus({ url: target.url, dir: options.dir });
        pending = `${plan.pending.length} file${plan.pending.length === 1 ? "" : "s"} pending`;
      } catch {
        // Unreachable or never baselined: say so and carry on.
        pending = "could not read the migration record";
      }
    }
    return { skipped: `MIGRATE_ON_DEPLOY is not "1" (automatic migrations are off for production; ${pending})` };
  }
  if (!target) {
    throw new MigrationError(
      "Production deploy without a database URL (MIGRATE_URL, POSTGRES_URL_NON_POOLING or POSTGRES_URL): " +
        "cannot migrate, so not building.",
    );
  }
  // Only the pooled URL at hand: fail the build before anything runs.
  assertDirect(target.url, target.source);
  options.log?.(`Migrating the production database (${target.source}).`);
  return migrate({ ...options, url: target.url });
}
