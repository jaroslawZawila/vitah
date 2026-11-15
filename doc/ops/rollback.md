# Rolling back

A rollback puts the previous deployment back in front of users in seconds. It does not touch the database.

## When

The new deployment is broken (the smoke test fails, errors in the log, users report it) and a fix is not minutes away.

## How

Vercel dashboard: project `vitah-web` › Deployments › the last good deployment › **Instant Rollback** (or **Promote to Production**).

Or the CLI:

```bash
npx vercel ls vitah-web --scope vitah-s-projects 2>&1 | head -8        # find the last good deployment's URL
npx vercel rollback <deployment-url> --scope vitah-s-projects
scripts/smoke.sh
```

Then fix forward: revert or correct the commit on `main` and push. A rollback leaves `main` ahead of what is live, and the next push deploys `main` again.

## Why it is safe, and when it is not

- Migrations are additive (or expand then contract), so the previous code runs on the newer schema. If a migration in the bad deploy broke that rule, rolling the code back is not enough: see [database.md](database.md).
- Data written by the new code stays. If the new code wrote something the old code cannot read, say so in the incident notes and repair it by hand.
- Stored derived values go stale under older code that does not maintain them. The CAE warnings and statuses
  (`cae_*` columns, `packages/db/sql/2026-11-15-0900-cae-stored-status.sql`): after running code from before that
  file, forget them once the current code is back (`UPDATE subcontractors SET cae_status = NULL, cae_valid_until =
  NULL; UPDATE subcontractor_assignments SET cae_warnings = NULL, cae_valid_until = NULL;`); the next reads work them out again.
- The client app is not rolled back by this: installed builds keep calling the API they know. `/api/mobile/*` and `/api/v1` stay backwards compatible for that reason.

## Not rehearsed yet

This procedure has not been run against production. Do one rehearsal at a quiet time (roll back to the previous deployment, run the smoke test, promote the current one again) and note here how long it took.
