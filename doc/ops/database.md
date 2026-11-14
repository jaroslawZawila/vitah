# Database

## Schema changes

`packages/db/src/schema.ts` says what the database should look like. Production changes only through the SQL files in `packages/db/sql/`, each applied once and recorded in the table `schema_migrations`. The rules for writing one are in `packages/db/sql/README.md`.

```bash
MIGRATE_URL=<direct url> pnpm db:sql:status      # applied / pending / changed. Reads only.
MIGRATE_URL=<direct url> pnpm db:sql:migrate     # applies what is pending, stops at the first failure
MIGRATE_URL=<direct url> pnpm db:sql:baseline -- <file.sql>   # records a file that was applied by hand
```

Use the **direct** connection string (`POSTGRES_URL_NON_POOLING`), never the pooled one: the run takes a session lock.

On a production deploy the build applies pending files itself when `MIGRATE_ON_DEPLOY=1` is set on Vercel's Production environment. Without it the build prints how many files are pending and you apply them by hand, before the deploy that needs them.

### A change old code cannot live with

Renaming or removing something takes two releases:

1. Release A adds the new thing and stops using the old one. Deploy it.
2. Release B (a later file) removes the old thing.

Never both in one deploy: for a few minutes the old code is still serving requests against the new schema, and a rollback would put it back.

## Is production what `schema.ts` says?

```bash
DRIFT_URL=<direct url> pnpm db:drift             # read-only on the target; needs a local PostgreSQL for the comparison
```

Exit 0: no drift. 1: differences, listed. Known leftovers that were kept on purpose are in `packages/db/drift-allow.json`, each with its reason. Run it after any change made by hand.

## Backups and restore

- **Database**: Neon keeps a history that allows restoring to a point in time. How far back depends on the plan: **confirm the retention window in the Neon console and write it here.**
- **Files** (Blob store): there is no second copy. A file removed from the store is gone. The application no longer removes files (deletes are soft), so the risk is the store itself or a mistake made by hand.

### Restore drill (do once, then twice a year)

1. In the Neon console, create a branch of the production database at a point in time an hour ago.
2. Point a local portal at that branch (`POSTGRES_URL=<branch url> pnpm exec turbo dev --filter=web`) and check a project, its budget and its payments open.
3. Run `DRIFT_URL=<branch url> pnpm db:drift`.
4. Delete the branch. Write down the date and how long it took.

Until this has been done once, assume a restore takes hours, not minutes.

## Bringing back something a user deleted

Deletes are soft: the row is still there with `deleted_at` and `deleted_by_id`. Until the portal has a screen for it, restoring is one statement, in a transaction, after checking it is the right row:

```sql
BEGIN;
SELECT id, ref, deleted_at, deleted_by_id FROM projects WHERE tenant_id = '<tenant>' AND deleted_at IS NOT NULL;
UPDATE projects SET deleted_at = NULL, deleted_by_id = NULL WHERE id = '<id>' AND deleted_at IS NOT NULL;
COMMIT;
```

The same two columns exist on `project_documents`, `project_photos`, `obra_issue_files`, `subcontractor_assignments`, `purchase_order_documents`, `purchase_invoices` and `purchase_payments`. Two cautions: a project's `ref` and a supplier's invoice `number` may have been reused since (the restore then fails on the unique index: rename one first), and restoring an invoice or a payment changes the order's and the supplier's totals.

## By hand, in production

Every statement run by hand in production is written in a file first, read by a second person if there is one, run in a transaction, and followed by `pnpm db:drift`. If it changed the schema, it becomes a file in `packages/db/sql/` and is recorded with `db:sql:baseline -- <file>`.
