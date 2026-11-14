# Operations

How ViTAH runs in production and what to do when it does not. Short on purpose: each page is a procedure.

| Page | When you need it |
|------|------------------|
| [deploy.md](deploy.md) | Shipping a change; what runs automatically and what to check |
| [rollback.md](rollback.md) | A deploy made things worse |
| [database.md](database.md) | A schema change, a drift check, a restore, bringing back a deleted record |
| [incident.md](incident.md) | Something is down or wrong right now |
| [secrets.md](secrets.md) | Where each secret lives and how to rotate it |
| [capacity.md](capacity.md) | How the portal behaves at volume (measured) |
| [mobile-release.md](mobile-release.md) | Building and releasing the client app |

## What runs where

- **Portal and API**: one Vercel project (`vitah-web`, team `vitah-s-projects`), production at https://portal.vitah.es. A push to `main` on GitHub builds and deploys it.
- **Database**: Neon PostgreSQL (EU). Vercel injects its connection strings; `POSTGRES_URL` is pooled, `POSTGRES_URL_NON_POOLING` is direct.
- **Files**: a private Vercel Blob store. Nothing in it has a public URL; files are streamed through the API after an auth check.
- **AI**: the Anthropic API, for the budget draft and the review of Compras documents, capped per tenant per month.
- **Checks**: GitHub Actions (`.github/workflows`): the gate on every push and pull request, the smoke test after each production deploy, and the health check on a schedule.
- **Client app**: Expo/EAS builds; it talks to the portal's `/api/mobile/*`.

## How you find out something is wrong

- The **health check** workflow fails and GitHub emails the repository owner: every 15 minutes if the portal is down, once a day if it is up but not fully healthy (`GET /api/health` says which check).
- The **smoke test** workflow fails after a deploy.
- The **CI** workflow fails on a push.
- A user quotes the code shown on an error page or returned by the API (`id` or `digest`): search the Vercel logs for it (see [incident.md](incident.md)).

Nobody is paged. If email is not enough, add an uptime monitor that can call or message a phone.

## Rules that keep this safe

1. Every change goes through the gate (tests, types, lint, build) before it reaches `main`.
2. A schema change is additive, or expand then contract: the previous deployment must keep working on the new schema, so a rollback is always possible ([database.md](database.md)).
3. Preview deployments use the production database until a separate one exists. Do not open a preview of a branch whose code writes data you would not want in production.
4. Nothing a user deletes is erased (soft delete). Hard deletes happen only by hand, in the database, on purpose.
5. The repository is public: never commit a secret, a dump, or anything about a customer.
