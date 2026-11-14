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

Deletes are soft: the row is still there with `deleted_at` and `deleted_by_id`, and its files are still in the Blob store. An admin restores it in the portal: the settings menu at the foot of the rail › **Elementos eliminados** (`/dashboard/eliminados`; `GET /api/v1/deleted`, `POST /api/v1/deleted/:kind/:id/restore`). It lists what was deleted, by whom and when, and "Restaurar" brings a record back as it was. Each restore leaves a trace: an entry in the order's history (an invoice, a payment, an order's document) or in the company's Historial (an assignment), else a log line `deleted.restored` with the kind, the id, the tenant and the user.

The screen refuses a restore that would break what the record's module holds a new one to, and says why. What to do then:

| It says | Do this, in the portal |
| --- | --- |
| Its obra (or its invoice) is deleted | Restore that one first, on the same screen. |
| Another invoice of that supplier has its number | Change the other invoice's number (Compras › Facturas › Editar), then restore. |
| It no longer fits what is left to pay, or what its invoice leaves | Delete or correct the payment or credit note registered in its place, then restore. |
| Its order is cancelled, not placed, of another supplier, or lost the lines it was split across | Put the order back as it was (its status, supplier and lines), then restore; or register the invoice again. |
| Its order now has a payment schedule and the invoice is on no milestone | Register the invoice again on its milestone (the deleted one stays deleted). |
| The company is now a material supplier | Nothing to restore: a material supplier has no obras. |
| Another project uses its ref | The portal cannot rename a project: see below. |

### By hand, when the screen refuses

Only for what the screen cannot do, and by the rules of "By hand, in production" below. The one case today is a project whose `ref` was reused: give one of the two another ref, then restore on the screen.

```sql
BEGIN;
SELECT id, ref, address, deleted_at, deleted_by_id FROM projects WHERE tenant_id = '<tenant>' AND ref = '<ref>';
-- The deleted one takes a ref nobody has; the live one keeps its own.
UPDATE projects SET ref = '<new ref>' WHERE id = '<id>' AND tenant_id = '<tenant>' AND deleted_at IS NOT NULL;
COMMIT;
```

Clearing the marks by hand is the last resort (the screen's checks do not run, nothing is logged, and the client's open app is not told):

```sql
BEGIN;
SELECT id, ref, deleted_at, deleted_by_id FROM projects WHERE tenant_id = '<tenant>' AND deleted_at IS NOT NULL;
UPDATE projects SET deleted_at = NULL, deleted_by_id = NULL WHERE id = '<id>' AND deleted_at IS NOT NULL;
COMMIT;
```

The same two columns exist on `project_documents`, `project_photos`, `obra_issue_files`, `subcontractor_assignments`, `purchase_order_documents`, `purchase_invoices` and `purchase_payments`. Two cautions: a project's `ref` and a supplier's invoice `number` may have been reused since (the restore then fails on the unique index: rename one first), and restoring an invoice or a payment changes the order's and the supplier's totals. Nothing is ever purged: there is no hard delete of these rows, in the portal or here.

## By hand, in production

Every statement run by hand in production is written in a file first, read by a second person if there is one, run in a transaction, and followed by `pnpm db:drift`. If it changed the schema, it becomes a file in `packages/db/sql/` and is recorded with `db:sql:baseline -- <file>`.
