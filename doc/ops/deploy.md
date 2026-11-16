# Deploying

## What happens on a push to `main`

1. **CI** (`.github/workflows/ci.yml`) runs the gate: tests on a throwaway PostgreSQL, type checks, lint, the portal's production build, a secret scan and a dependency audit (the audit does not block).
2. **Vercel** builds and deploys production at the same time. It does not wait for CI. Until branch protection requires the CI checks, a red CI does not stop a deploy: watch it.
3. The build runs `db:sql:deploy` before `next build`. With `MIGRATE_ON_DEPLOY=1` on the Production environment it applies pending migration files and fails the build if one fails; without it, it only prints how many are pending.
4. When Vercel reports the deployment successful, the **smoke** workflow (`smoke.yml`) runs `scripts/smoke.sh` against production.

The functions run in Frankfurt (`fra1`), beside the database (Neon `eu-central-1`): `apps/web/vercel.json` › `regions`, which wins over the project's dashboard setting and applies to previews too. To check: `curl -sI https://portal.vitah.es/api/health | grep -i x-vercel-id` answers `<entry>::fra1::…` (the first part is the entry point nearest the caller). If the database ever moves, move this with it.

## Before you push

- The local commit gate has passed (it runs on every commit made through Claude Code; otherwise run `pnpm exec turbo run test check-types lint` and `pnpm exec turbo run build --filter=web`).
- If the change adds a file under `packages/db/sql/`: it follows the rules in that folder's `README.md`, and you know whether production applies it automatically (`MIGRATE_ON_DEPLOY=1`) or you apply it first by hand.
- If old code would break on the new schema, split the change (see [database.md](database.md)).
- If the new code reads a column or a table the file adds, production must have it **before** the code goes live: every read of a table names all its columns, so a missing one is a 500 on every page that reads that table. While `MIGRATE_ON_DEPLOY` is off, apply the file first (`db:sql:migrate`, or by hand and then `db:sql:baseline -- <file>`); an additive file is safe to apply ahead, the code running meanwhile ignores it.
- A file that adds constraints or changes keys locks its tables while it runs. Run it at a quiet hour. Such files start with `SET LOCAL lock_timeout = '5s'`: if a lock is not free they fail whole and change nothing; run them again. Afterwards `pnpm db:drift` must list no constraint left `NOT VALID` (one that existing rows break is left unvalidated with a notice in the output, and only the drift check shows it later).

## After you push

```bash
npx vercel ls vitah-web --scope vitah-s-projects 2>&1 | head -5      # the new deployment: Building, then Ready
scripts/smoke.sh                                                      # the same checks the workflow runs
npx vercel logs --project vitah-web --scope vitah-s-projects \
  --deployment <deployment-url> --query 'level:error' --since 30m --non-interactive
```

"Ready" only means the build finished. The smoke test and an empty error log are what say it works.

## Preview deployments

Every other branch pushed to GitHub gets a preview URL (behind Vercel login). It uses the **production database**, the production file store and the production session secret. It never runs migrations. Treat a preview as production with a different URL.

A preview runs its branch's code, which may be older than production's. Two things follow. Its code may not maintain what newer code stores: the stored CAE values (`cae_*` columns) go stale without a trace if an older branch's preview is used to edit Subcontratas data; clear them afterwards (the two statements are in [rollback.md](rollback.md)). And its code may read columns production does not have yet, or miss ones it has: do not use a preview to change data.
