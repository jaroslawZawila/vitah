# Database migrations

`schema.ts` says what the database should look like. Local and test databases are built from it
(`drizzle-kit push`). Production is never pushed: it changes only through the SQL files in this folder,
applied once each, in name order, by the runner (`packages/db/src/ops/migrate.ts`), which records them in
the table `schema_migrations` (file name, sha256, when, and whether it was only recorded by the baseline).

## Commands

The database is `MIGRATE_URL`, else `POSTGRES_URL_NON_POOLING`, else `POSTGRES_URL`. Nothing prints the URL.
It must be a **direct** connection: `migrate`, `baseline` and the deploy refuse a pooled URL (Neon's
`…-pooler` host, which is what Vercel's `POSTGRES_URL` is) before running anything, because the lock that
keeps two runs apart does not hold through a pooler. `status` only reads and takes either.

```bash
MIGRATE_URL=… pnpm db:sql:status     # every file: applied / pending / CHANGED. Reads only.
MIGRATE_URL=… pnpm db:sql:migrate    # applies the pending files in order, stops at the first failure
MIGRATE_URL=… pnpm db:sql:baseline   # records every file as applied WITHOUT running it (once, see below)
MIGRATE_URL=… pnpm db:sql:baseline -- 2026-12-01-0900-x.sql   # records one file applied by hand
MIGRATE_URL=… pnpm db:sql:baseline -- --except a.sql,b.sql    # the first baseline, leaving out files not applied yet
DRIFT_URL=…   pnpm db:drift          # compares a database with schema.ts (below)
```

`status` exits non-zero whenever `migrate` would refuse: an applied file whose content changed, a badly
named or out-of-order file, a new file with a `BEGIN`/`COMMIT` of its own (rule 5), or a database with
tables and no recorded migration.

## On deploy

`apps/web`'s `build` runs `db:sql:deploy` before `next build`. It migrates **only when
`VERCEL_ENV=production` and `MIGRATE_ON_DEPLOY=1`** (a variable set on Vercel's Production environment: the
switch that turns automatic migrations on). Anywhere else (your machine, CI, a Preview deployment, which
shares production's database) it prints one line and does nothing. On production without the switch it
only prints how many files are pending and builds anyway: applying them then stays a manual step
(`db:sql:migrate`, or by hand followed by `db:sql:baseline -- <file>`). A failed migration fails the build, so new code never goes
live on a database that was not migrated. Two builds at once wait for each other (a session advisory
lock, which only a direct connection holds: with nothing but the pooled `POSTGRES_URL` the build fails
and says so, before running anything; Vercel provides `POSTGRES_URL_NON_POOLING` with the database).
Turbo's cache key for the build includes these
files, `VERCEL_ENV` and the database URLs (`turbo.json`), so a cached build is only replayed when a
production build already applied the same files.

So the old code keeps running against the new schema until the deploy finishes, and again after a
rollback. Hence the rules.

## Rules for a file

1. **Additive, or expand then contract.** Add columns (nullable or with a default), tables, indexes. To
   rename or remove: first a release that stops using the old thing, then a later file that drops it. The
   previous deployment must work on the new schema.
2. **Never edit a file once it is applied** (merged to `main`). The runner compares checksums and refuses to
   go on. Put the fix in a new file.
3. **One concern per file**, and idempotent where it costs nothing (`IF NOT EXISTS`, `DO` blocks that check
   first): a file may be applied by hand before it is recorded.
4. **Name it `YYYY-MM-DD-HHmm-topic.sql`, the time in UTC**, e.g. `2026-11-14-0930-invoice-notes.sql`.
   Files run in name order; the older `YYYY-MM-topic.sql` files run before any timestamped one. A new
   file that sorts before one already applied is refused: rename it with the current date and time (this
   happens when a branch waits while a later-dated file is merged).
5. **No `BEGIN`, no `COMMIT`: the runner provides the transaction.** Each file runs in ONE transaction
   together with its record in `schema_migrations`: all of it and the record, or nothing, so a file is
   never half applied nor applied without being recorded. A new file therefore has no transaction control
   of its own (`BEGIN`, `START TRANSACTION`, `COMMIT`, `END`, `ROLLBACK` as statements; the `BEGIN … END` of
   a `DO` block or a function body is fine, and so is `ROLLBACK TO` a savepoint): `status` and `migrate`
   refuse one that has, naming the file and the line. A new enum value (`ALTER TYPE … ADD VALUE`) cannot
   be used in the transaction that adds it: add it in one file, use it in the next.
6. **A file that cannot run in a transaction says so on its first line:**

   ```sql
   -- migrate: no-transaction
   CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_supplier_idx ON purchase_orders (subcontractor_id);
   ```

   Only for what Postgres refuses inside a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`, …). Its
   statements are sent one by one, exactly as written, with no transaction around them, and the file is
   recorded after the last one. Nothing ties the two together: if a statement fails, or the run dies before
   the record is written, what was done stays and the next run starts the file again from its first
   statement. **Such a file must be safe to run twice**: `IF NOT EXISTS` / `IF EXISTS` on everything, and
   drop an index a failed `CONCURRENTLY` left invalid (`DROP INDEX CONCURRENTLY IF EXISTS …` first). Keep
   it to that one thing; everything that can run in a transaction goes in an ordinary file.

The files named `YYYY-MM-topic.sql` predate these two rules: several have their own `BEGIN`/`COMMIT`. They are
only ever recorded by the baseline on a real database, never run by the runner there, and are left as they are.

## Checking a new file before it is merged

There is no chain from zero: the first schema was pushed, and several old files drop or rewrite things, so
the files cannot rebuild a database and nobody should try. Each new file is checked on its own instead:

1. Build a scratch database in the **previous** schema state: check out `main`, create an empty database,
   `POSTGRES_URL=<scratch> pnpm db:push`, then `MIGRATE_URL=<scratch> pnpm db:sql:baseline`.
2. Back on your branch: `MIGRATE_URL=<scratch> pnpm db:sql:migrate` applies your file.
3. `DRIFT_URL=<scratch> pnpm db:drift` must report no drift: the file takes the old schema to exactly what
   the new `schema.ts` defines. Run the migrate a second time by hand if the file claims to be re-runnable.

## Drift check

`pnpm db:drift` builds `schema.ts` in a scratch database (`drizzle-kit push`, on the Postgres at
`DRIFT_SCRATCH_URL`, default the local Docker one; the database is created and dropped), reads both it and
`DRIFT_URL` from `pg_catalog`, and prints what is **missing in the target**, **extra in the target** or
**different**: tables, columns (type, nullability, default), indexes, primary-key / unique / check
constraints, foreign keys (by columns, referenced table and on-delete/on-update rule, never by name) and
enum values. The target is opened read-only (`default_transaction_read_only`), so give it a direct URL,
not a pooled one. `schema_migrations` is ignored by design: it is the runner's table, not in `schema.ts`.
A check or foreign key that is there but `NOT VALID` (added so, and its validation failed or never ran:
the rows from before it were never checked) is reported as different, with the `VALIDATE CONSTRAINT` to
run once those rows are fixed.

A new constraint on a table that already has rows goes in `NOT VALID` and is validated on its own, in
a `BEGIN … EXCEPTION … END` block that turns a failure into a `NOTICE` naming it: the file never fails
on old rows, new writes are checked at once, and the drift check lists what is left to validate (see
`2026-11-15-1000-check-constraints.sql`).

Exit code 0: no drift. 1: drift. 2: it could not run.

Known, accepted differences go in `packages/db/drift-allow.json`, each with the reason:

```json
{
  "ignore": [
    { "item": "table legacy_orders", "reason": "Framer-era data, kept for the archive" },
    { "item": "column projects.old_ref", "reason": "still read by the accountant's export" }
  ]
}
```

`item` is the line the report prints (`table x`, `column x.y`, `index x.name`, `constraint x.name`,
`foreign key x(a) -> y(b)`, `enum x`). `table x` covers everything in that table. Entries that no longer
match anything are listed so they can be removed.

## A database that predates the runner (production, once)

Production already has everything the old files do (the 27 named `YYYY-MM-topic.sql`), and nothing recorded. `migrate` refuses such a
database (tables, no record) because several of those files are not safe to run again. Before the first
deploy that includes the runner, with production's direct URL:

```bash
MIGRATE_URL=… pnpm db:sql:status     # 27 pending, and the refusal
MIGRATE_URL=… pnpm db:sql:baseline   # records the 27, runs nothing
MIGRATE_URL=… pnpm db:sql:status     # 27 applied (baseline), exit 0
```

Make sure every one of those files really was applied by hand first. If the baseline is forgotten, the
production build fails at `db:sql:deploy` with that refusal and the previous deployment stays live;
nothing is run.
