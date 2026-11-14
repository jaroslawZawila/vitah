# Deploying

## What happens on a push to `main`

1. **CI** (`.github/workflows/ci.yml`) runs the gate: tests on a throwaway PostgreSQL, type checks, lint, the portal's production build, a secret scan and a dependency audit (the audit does not block).
2. **Vercel** builds and deploys production at the same time. It does not wait for CI. Until branch protection requires the CI checks, a red CI does not stop a deploy: watch it.
3. The build runs `db:sql:deploy` before `next build`. With `MIGRATE_ON_DEPLOY=1` on the Production environment it applies pending migration files and fails the build if one fails; without it, it only prints how many are pending.
4. When Vercel reports the deployment successful, the **smoke** workflow (`smoke.yml`) runs `scripts/smoke.sh` against production.

## Before you push

- The local commit gate has passed (it runs on every commit made through Claude Code; otherwise run `pnpm exec turbo run test check-types lint` and `pnpm exec turbo run build --filter=web`).
- If the change adds a file under `packages/db/sql/`: it follows the rules in that folder's `README.md`, and you know whether production applies it automatically (`MIGRATE_ON_DEPLOY=1`) or you apply it first by hand.
- If old code would break on the new schema, split the change (see [database.md](database.md)).

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
