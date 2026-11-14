# Secrets

No secret is in the repository (it is public; the CI secret scan fails a push that adds one). They live in Vercel's environment variables. A developer machine may hold a local copy in an untracked `.env*` file: keep it readable by its owner only (`chmod 600`), and do not keep production values on a laptop longer than needed.

| Secret | What it protects | Where it is set | Rotating it |
|--------|------------------|-----------------|-------------|
| `NEXTAUTH_SECRET` | Signs portal sessions and the app's 30-day tokens | Vercel (Production, Preview) | New value → redeploy. **Everyone is signed out**, staff and clients; the app asks its users to sign in again. Do it at a quiet time and tell people first. |
| Database credentials (`POSTGRES_URL` and its siblings) | All data | Injected by the Neon integration | Reset the role's password in Neon; the integration updates Vercel; redeploy. Old connections drop. |
| `BLOB_READ_WRITE_TOKEN` | Every stored file | Injected by the Blob store connection | Rotate in the store's settings; redeploy. |
| `ANTHROPIC_API_KEY` | AI spend | Vercel (Production), set by hand | Create a new key at the provider, set it, redeploy, revoke the old one. |
| Firebase key in `apps/mobile/google-services.json` | Push delivery on Android | In the repository (it ships inside the app) | Not a secret, but it must be restricted to the app in Google Cloud. |
| EAS / store credentials | App builds and submissions | Expo account | Managed by `eas credentials`. |

## Things to fix

- Preview and Production share the database, the file store and `NEXTAUTH_SECRET`. Until Preview has its own, a preview deployment is production.
- The application connects as the database's owner. A separate role that can read and write rows but not change the schema would limit what a bug or an injection could do; migrations would then use the owner's URL (`MIGRATE_URL`).
- Rotate `NEXTAUTH_SECRET` and the database password after anyone with access to them leaves.
