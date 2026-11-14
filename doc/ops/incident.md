# When something is wrong

## First five minutes

1. **Is it up?** `curl -s https://portal.vitah.es/api/health` → `status`:
   - `ok`: the portal, the database and the background work are fine. The problem is narrower: go to "A user reports an error".
   - `degraded`: up, but a check needs attention. `checks.ai: attention` means a budget generation failed in the last day, a document review has been waiting over an hour, or a tenant is near its monthly AI limit. `checks.migrations: untracked` means the database has no migration record.
   - `down` (HTTP 503) or no answer: the database cannot be reached, or the deployment is broken.
2. **Did a deploy just go out?** `npx vercel ls vitah-web --scope vitah-s-projects 2>&1 | head -5`. If the trouble started with it, roll back first ([rollback.md](rollback.md)) and investigate after.
3. **What do the logs say?**

```bash
npx vercel logs --project vitah-web --scope vitah-s-projects --query 'level:error' --since 1h --non-interactive
```

Every server error is one JSON line: `event` (`request.error` for an unhandled error, `api.internal_error` for an API 500, `mobile.client_error` for a crash reported by the app), `path`, `error.name`, `error.message`, and `digest` or `id`.

## A user reports an error

Ask for the code on the error page (the `digest`) or in the API answer (`id`), and search for it:

```bash
npx vercel logs --project vitah-web --scope vitah-s-projects --query '<code>' --since 24h --non-interactive
```

## Common causes

| What you see | Likely cause | What to do |
|--------------|--------------|------------|
| Every page of one area answers 500 right after a deploy; the log says a column or table does not exist | The code went out before its migration | Apply the pending file ([database.md](database.md)) or roll back |
| `status: down` | Neon unreachable or paused, or the connection string changed | Check the Neon console and Vercel's environment variables |
| Uploads or downloads fail, pages load | The Blob store or its token | Check the store in the Vercel dashboard; see [secrets.md](secrets.md) |
| The budget draft never finishes, or document reviews stay "pending" | The Anthropic key, the tenant's monthly AI limit, or the provider | The run's log on the budget page; `checks.ai`; the provider's status page |
| "Demasiados intentos" on sign-in for one person | The sign-in throttle (10 failures per address and email in the window) | It clears by itself when the window ends; nothing to reset |
| A staff member is signed out everywhere | Their password was changed or reset, or the account was deactivated | Expected: sessions from before the change stop within a minute |
| Something a user deleted must come back | Soft delete | [database.md](database.md), "Bringing back something a user deleted" |

## Afterwards

Write down, in the issue or wherever the team keeps notes: when it started and ended, what users saw, the cause, what fixed it, and the one change that would have prevented it or shortened it. If a check should have caught it, add the check.
