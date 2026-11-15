# ViTAH — Monorepo

PropTech platform for healthy, efficient, intelligent homes. Tagline: "Tecnología para vivir mejor".

## Architecture

Turborepo monorepo with pnpm@9.0.0 workspaces.

### Apps

| App | Package name | Port | Purpose |
|-----|-------------|------|---------|
| `apps/web` | `web` | 3000 | Portal (login, dashboard) **and** the API (`/api/v1/*`, `/api/mobile/*`) |
| `apps/mobile` | `mobile` | — | Expo / React Native app; calls the `apps/web` API with a Bearer token |

### Shared Packages

| Package | Name | Purpose |
|---------|------|---------|
| `packages/core` | `@repo/core` | Business logic / service layer (tenant-scoped, takes `ctx`) — the single API. `./contract` holds DB-free types/constants safe for mobile and browser code (`src/contract.ts` re-exports `src/contract/<domain>.ts`; a part never imports `@repo/db`, zod or server code, and imports its siblings, never `../contract`) |
| `packages/auth` | `@repo/auth` | NextAuth.js v5 config, credential checks (`./credentials`), mobile JWT (`./mobile`), request context (`./context`) |
| `packages/db` | `@repo/db` | Drizzle ORM schema, database client, seed script (postgres.js driver), test helpers (`./testing`, `./vitest`) |
| `packages/tailwind-config` | `@repo/tailwind-config` | Shared Tailwind v4 theme with ViTAH brand tokens |
| `packages/eslint-config` | `@repo/eslint-config` | ESLint configs (`./base`, `./next-js`, `./react-internal`) |
| `packages/typescript-config` | `@repo/typescript-config` | Shared tsconfig (`base.json`, `nextjs.json`, `react-library.json`, `internal-package.json` for source-only packages) |

## Commands

```bash
pnpm exec turbo dev                  # Run all apps
pnpm exec turbo dev --filter=web     # Run web only (port 3000)
pnpm exec turbo build                # Build all
pnpm exec turbo build --filter=web   # Build web only
pnpm exec turbo lint                 # Lint all
pnpm exec turbo check-types          # Type check all
pnpm test                            # Run all tests (needs `pnpm db:up`)
pnpm run format                      # Prettier format all
pnpm db:up                           # Start local PostgreSQL (Docker)
pnpm db:down                         # Stop local PostgreSQL
pnpm db:setup                        # Full local DB bootstrap (start + push + seed)
pnpm db:push                         # Push schema to database
pnpm db:generate                     # Generate migration files
pnpm db:migrate                      # Apply migrations
pnpm db:seed                         # Seed tenant, admin, one project + its app client
pnpm db:studio                       # Open Drizzle Studio (DB browser)
pnpm db:sql:status                   # Prod migrations: applied / pending (MIGRATE_URL); also db:sql:migrate, db:sql:baseline
pnpm db:drift                        # Compare a database (DRIFT_URL, read-only) with schema.ts
scripts/smoke.sh [url]               # The post-deploy smoke test (default https://portal.vitah.es)
```

## Ways of Working

Every change goes through this, in order. Nothing gets committed until every step is done.

1. **Implement the whole feature.** A feature is done only when every surface it touches works:
   - **Platform**: `packages/core` logic, then the server action, the `/api/v1` route (backwards compatible),
     the portal UI, and the DB schema. Prod changes use additive SQL only (no plain `db:push`)
   - **App** (`apps/mobile`): the screens, API client and types (from `@repo/core/contract`), following
     `doc/mobile-app-design/`
   - Both `es.json` and `en.json` for any new text. Don't leave a half-done side: if the app needs it,
     build the app part too. If a feature really is web-only or app-only, say so explicitly
2. **Test it.** All new or changed code has tests: core (Vitest, real DB), server actions and
   `/api/v1` routes (Vitest), and mobile (jest-expo). Cover the happy path, errors and tenant isolation.
3. **Review and simplify.** Run `/simplify` on the diff, then `/code-review`, and fix what they find.
   Re-run the tests afterwards.
4. **Green, then commit.** `pnpm test`, `pnpm exec turbo check-types`, `pnpm exec turbo lint` and the
   portal build (`pnpm exec turbo build --filter=web`) must all pass (DB tests need `pnpm db:up`). A Claude
   Code hook (`.claude/hooks/commit-gate.sh`) runs all four on every `git commit` and blocks the commit if
   any of them fail. Never bypass it or skip failing tests. GitHub Actions runs the same gate on every push and pull
   request (`.github/workflows/ci.yml`, with a secret scan and a dependency audit), the smoke test after each
   production deploy (`smoke.yml`) and the health check on a schedule (`health.yml`: every 15 min "is it up", daily
   "is it fully healthy"; a failure emails the repository owner). The repository is public: no workflow may read a
   secret, upload an artifact or print data.

## Tech Stack

- **Next.js 16.4.1** (App Router, Turbopack)
- **React 19.2.3** / TypeScript 5.9.2 — one React across the monorepo, pinned by root `pnpm.overrides`
- **Expo SDK 57** / React Native 0.86 (New Architecture only), Expo Router 57, jest-expo. Icons from
  `@react-native-vector-icons/feather` (not the deprecated `@expo/vector-icons`). `apps/mobile` keeps
  TypeScript 5.9.2 via `expo.install.exclude`; upgrade with `npx expo install expo@^<sdk> && npx expo install --fix`
- **NextAuth.js 5.0.0-beta.32** — Credentials provider, JWT sessions, Drizzle adapter
- **Drizzle ORM 0.45** + **postgres.js** — database layer with multi-tenant schema (works with any PostgreSQL)
- **next-intl 4.12.0** — i18n (Spanish default, English)
- **Tailwind CSS 4.3.0** + **shadcn/ui** (Base UI primitives, `base-nova` style) — the portal's only styling; no CSS Modules
- **Fonts** (`next/font/google`): Figtree (body), Barlow Condensed (headings, KPI figures), JetBrains Mono (numbers)

## Key Conventions

### API-first: one service layer, two thin adapters

The portal and the mobile app share one backend. Layers:

1. **`packages/core`** — all business logic. Functions take `ctx: Ctx` (`{ tenantId, userId, role }`)
   first and scope every query to `ctx.tenantId`. Throw `CoreError(code, status)` for expected failures.
   Never import Next.js APIs here.
2. **Portal adapter** — `apps/web/app/actions/*.ts` server actions: `getSessionContext()` →
   call core → `revalidatePath`. No business logic.
3. **Mobile/API adapter** — `apps/web/app/api/v1/**/route.ts`: `withContext(request, ctx => core…)`
   from `apps/web/lib/api.ts`. Accepts `Authorization: Bearer <mobile JWT>` or the session cookie.
   Errors are JSON `{ error: code }`.

When adding a feature: write it in `packages/core`, then add the server action and the `/api/v1`
route. In the portal, keep UI separate from logic: a page's container component (e.g.
`ClientsScreen.tsx`) is the only file that calls server actions; presentational components in
`components/` take data and callbacks as props only. Multi-step flows use `dashboard/components/wizard`: to add a
step to new-project creation, extend `ProjectDraft` and core `createProject`, write a step component
+ summary in `projects/new/steps/`, and register it in `PROJECT_STEPS`. Server data a step needs goes in
`ProjectFlowOptions` (loaded in `projects/new/page.tsx`); `when` hides a step (e.g. the client step for non-admins). Keep `/api/v1` backwards compatible — installed mobile builds lag behind.

**Input validation.** Every body a core write takes goes through a zod schema at the top of the core function:
`parse(schema, input)` from `packages/core/src/inputs/fields.ts`, placed after the checks that came first before
(`requireEditor`, the `require*` lookups, a state check), so 403/404/409 keep their precedence over a field's 400.
Schemas live in `packages/core/src/inputs/<module>.ts` (DB-free: zod, `./fields`, `../contract` only), built from the
blocks in `fields.ts`, which carry the error codes: a field's code is its zod `error`, and `parse` throws the first
one as a 400 `CoreError`. Unknown keys are dropped, never refused (no `.strict()`); a key sent as `undefined` counts
as not sent; checks that need the database or another field stay in code after `parse`. The `z.input` types
(`<Thing>Input`) are re-exported from `@repo/core/contract` as types only, so the app and the browser never load zod;
server actions and form builders take those types. Responses are never validated at runtime. Every money input is
`cents()`, bounded by `MAX_AMOUNT_CENTS` (20 M €, `packages/core/src/money.ts`, also in `@repo/core/contract`):
amounts are stored as 32-bit integers, so one too large is a 400, never a database error (a modificado's totals and
the milestone an order edit adds are refused the same way). SQL totals of money are computed in `bigint`/`numeric`
(never `::int`, never 32-bit arithmetic per row) and read back as numbers (`sql<number>…mapWith(Number)`, or
`Number()` on a `db.execute` row: postgres.js returns them as text).

### Mobile app design (apps/mobile) — MUST follow

The approved client app design is **Concept A "Grafito"**, documented in
`doc/mobile-app-design/README.md`, with one `A-*.dc.html` mockup per screen in the same folder
(live prototype: https://claude.ai/artifact/DjsuyQ9747VaRm7toZmpBj, top row only).
Before building or changing any mobile screen or feature, read that README and the screen's mockup,
and match its layout, navigation (5-tab bar), colours, type scale and components. For a feature the
mockups don't cover, extend the same visual language. Concept B on the canvas was rejected.

### Mobile-first responsive design (apps/web)

`apps/web` must always be mobile-friendly:
- Design mobile layout first, enhance for desktop with `min-width` media queries
- Test at 320px, 480px, 768px, 1024px breakpoints
- The grafito sidebar is a sticky column from `lg`; below that it becomes a top bar whose sections and
  project tabs scroll sideways
- Touch targets minimum 44px (`Button`, `Input` and `NativeSelect` grow to 44px on `pointer-coarse`)
- No horizontal scroll at any viewport width
- Use `clamp()` for fluid typography where appropriate

### ViTAH Brand Identity

**Color palette** (brand colours, Tailwind `bg-verde-oliva` etc. from `@repo/tailwind-config`):
- `--grafito: #1e1e1e` — primary dark background
- `--verde-oliva: #6b7a4a` — accent (buttons, interactive elements)
- `--verde-oliva-hover: #7d8e58` — hover state
- `--blanco-calido: #e8e7e2` — text on dark, light surfaces
- `--verde-oscuro: #37505a` — secondary accent

In the portal, use the theme tokens (below), not these raw colours: verde oliva is `primary`, grafito is `rail`.

**Design style:** "Minimalista de Lujo" — generous whitespace, no decorative effects, no shadows on logo, subtle transitions.

**Logo:** Wordmark "ViTAH" (note casing: V-i-T-A-H) with wide letter-spacing. Always paired with descriptor "TECNOLOGÍA PARA VIVIR MEJOR" in uppercase.

**Approved logo backgrounds:** Grafito, Blanco Cálido, Verde Oscuro only.

**Do NOT use:** orange #D4500A, navy #1A2B4A (old Framer SF brand colors).

### i18n

- Default locale: `es` (Spanish)
- Supported: `es`, `en`
- Translation files: `apps/web/messages/{locale}.json` (portal); `apps/mobile/messages/{es,en}.ts` (app — `useI18n().t("key")` from `apps/mobile/lib/i18n.tsx`; the language is picked in Perfil, stored on the phone)
- Config: `apps/web/i18n/request.ts`. The portal's language is a per-user setting: `users.language` (`es` | `en`, null
  = the browser's), switched with ES | EN at the foot of the rail (`setLanguageAction`, `PATCH /api/v1/me`) and read
  from the database on every render (`resolveLocale` in `i18n/locale.ts`), so it applies at once on every device.
  Signed out (the login page), it follows the browser. Prod SQL: `packages/db/sql/2026-10-user-language.sql`
- All user-facing text must use `useTranslations()` — never hardcode strings
- Add keys to both `es` and `en` files when adding new text
- Client components get only the messages their layout gives them: `<ClientMessages scope="<folder under app/>">` in
  a `layout.tsx`, with the paths listed in `apps/web/i18n/client-messages.ts` (`CLIENT_MESSAGES`: a namespace or a
  part of one such as `construction.tabs`). The login page gets only `login` and `errorPages`. Each layout sends only
  the paths it adds, less what a layout above sends (`scopeMessages`); the browser merges them into the messages above
  (`i18n/NestedMessages.tsx`), so a page that renders a deep layout anew re-sends only that layout's part. A new
  `useTranslations("x")` in a client component, or a new section, needs its path added at the deepest layout that
  renders it: `i18n/client-messages.test.ts` reads the code and fails, naming the file and path, when one is missing,
  misplaced, unused or sent twice. Namespaces must be string literals (`useTranslations("…")`, `namespace="…"` for
  `FormError` / `FileSlot`, `useConfirm("…")`); never `useTranslations()` with no namespace in a client component.
  A component reading one or two keys of a big namespace gets its own small sub-namespace (`purchasing.latePill`,
  `budget.revisionPill`), so the pages showing it don't take the whole namespace. Server components still read the
  whole catalogue (`getTranslations`)

### Multi-Tenancy

- **Tenant** = an organization/company using the ViTAH platform
- All data tables have a `tenantId` foreign key — queries always filter by tenant
- Users belong to exactly one tenant. No cross-tenant access.
- `tenantId` is stored in the JWT token and session, set at login time
- Server actions extract `tenantId` from session and scope all queries to that tenant
- User emails are unique per tenant (composite unique), not globally

### Auth

- Config lives in `packages/auth/src/index.ts` with Drizzle adapter
- Credentials provider: authenticates against `users` table with bcrypt password hashing
- JWT sessions include `role` and `tenantId` fields
- `NEXTAUTH_SECRET` + `POSTGRES_URL` required in each app's `.env.local`
- Login page is `/`, authenticated users redirect to `/dashboard` (which redirects to `/dashboard/projects`)
- `proxy.ts` runs for every route except `/api/auth/*`, `/api/mobile/*`, `/api/v1/*`, `/api/health`, `/api/csp-report` and static assets: it reads the
  session (the 60 s re-check), sends a signed-in user from `/` to the dashboard and sets the page's script policy (see Operations). It does **not** turn a
  signed-out visitor away: next-auth calls our handler even when `authorized` says no. The pages do that themselves (the dashboard layout, `read()` /
  `requireSession`, every server action via `getSessionContext()`), and the API routes authenticate per request: a new page or action must too
- User roles: `admin`, `manager`, `viewer` (staff, portal only) and `client` (homeowner, mobile app only) — Postgres enum. Use `isStaffUser` / `isClientUser` / `STAFF_ROLES` from `@repo/db`. `Ctx` is staff-only: client tokens are rejected by `/api/v1`
- Clients are created on the **Clients** tab (`/dashboard/clients`, admin only): first name, surnames, date of birth, address, phone, email and app password. Personal details live in `client_profiles`; login data stays on `users`. Client emails are unique across tenants. A project has at most one client, picked from the existing clients on the project page ("Client app access" card); removing them only detaches, the account stays. A client may have **several projects** (homes): see "Several homes" below
- Mobile client API: `POST /api/mobile/auth` (clients only, returns a 30d JWT), `GET /api/mobile/projects` (all their homes, the default first), `GET /api/mobile/project`, `GET /api/mobile/documents` and `GET /api/mobile/documents/:id` (the PDF), `GET /api/mobile/photos` and `GET /api/mobile/photos/:id` (`?size=thumb`), `POST /api/mobile/password`, `GET`/`PUT /api/mobile/settings` (notification toggles, `deletionRequestedAt`), `POST`/`DELETE /api/mobile/account/deletion-request`, `POST`/`DELETE /api/mobile/push-token` (the phone's Expo push token + app language), `GET /api/mobile/obra` (the Obra tab: stage, progress, phases, payment hitos), `GET /api/mobile/obra/hitos/:id/:kind` (a hito's signed `acta` or `invoice` PDF), `GET /api/mobile/contact` (site manager + office, see "Contact"), `GET /api/mobile/approvals` and `POST /api/mobile/approvals/:id/decision` (a change to approve: see Budget) and `GET /api/mobile/changes` (change counters, see "Live updates") — all `Authorization: Bearer`, via `withMobileClient` in `apps/web/lib/api.ts`. Each request re-checks the client is still active. `project`, `obra`, `photos`, `documents`, `contact` and `changes` take `?projectId=` (`projectParam`), else the default home
- Several homes: core `client-projects.ts` (`clientProjectsService`): `resolveClientProject` picks the one asked for (404
  `project_not_found` if not theirs) or the default, the newest not handed over (stage < 8, by start date, else created),
  else the newest of all. A file (photo, document, hito PDF) opens for any of the client's homes. The app
  (`lib/use-project.tsx`) shows one home everywhere; the client's choice is kept on the phone (`vitah_project`, forgotten on sign-out; a tapped
  push shows its home without changing it), each home's documents offline in their own folder. With one home the app looks as it always did. Pushes name the home (ref in the
  title) when there are several and carry `projectId`. Design `doc/mobile-app-design/A-*Viviendas*.dc.html`. Prod SQL:
  `packages/db/sql/2026-11-client-several-projects.sql` (drops `projects_client_user_unique`)
- Admin-only server actions guarded by `requireAdmin()` check
- Passwords: one policy for everyone (`MIN_PASSWORD_LENGTH` 10 + an uppercase letter + a digit, `isStrongPassword` in
  `@repo/core/contract`); existing shorter ones still sign in. Staff change their own in the rail's settings
  (`changeMyPassword`, `POST /api/v1/me/password`; the browser is signed in again, every other session ends); an admin
  resets another staff user's on Usuarios (`resetUserPassword`, `PUT /api/v1/users/:id/password`). A change, a reset or
  a deactivation sets `password_changed_at`: sessions from before it (their `authAt` claim; `iat` for Bearer tokens)
  stop at the next 60 s re-check (cookie sessions) or request (Bearer), after a 30 s grace so the browser that
  just changed it is not thrown out (`revokedByPasswordChange` in `@repo/auth`, the one rule for all three)
- Two-step sign-in for staff (TOTP, optional, self-enrolled in the rail's settings; `packages/core/src/{totp,mfa,
  mfa-secret}.ts`, table `user_mfa`): the secret is AES-256-GCM encrypted with a key derived from `NEXTAUTH_SECRET`
  (rotating it means re-enrolling), ten single-use recovery codes, a replayed code is refused. `authorize` asks for the
  code only after a correct password (so a wrong password never reveals whether MFA is on) and a wrong code counts in
  the throttle. An admin removes another user's on Usuarios (it ends their sessions). API `/api/v1/me/mfa/*`,
  `DELETE /api/v1/users/:id/mfa`. Clients (the app) have none. Prod SQL: `packages/db/sql/2026-11-14-1710-user-mfa.sql`
- Sign out: "Cerrar sesión" at the foot of the rail's settings menu (`signOutAction`)
- Sign-in throttle (`packages/core/src/throttle.ts`, portal and app): an IP gets 10 failures per email and 100 across
  emails per window, then is refused even with the right password; failures on one email from elsewhere never lock its
  owner out, they only cut each IP's allowance for it to 3. Only failures count

### Database

- **Driver:** `postgres` (postgres.js) — works with any PostgreSQL (local Docker, Vercel Postgres, AWS RDS, etc.)
- Schema in `packages/db/src/schema/` by module (`tenants`, `users`, `projects`, `project-files`, `budget`, `budget-approvals`, `hitos`, `construction`, `ai`, `subcontractors`, `purchasing`, `purchase-requests`, `purchase-invoices`, `purchase-checks`, `planning`, `idempotency`, `warranty`, `relations`; `checks.ts` holds `COLUMN_VALUES`, `COLUMN_RANGES` and the CHECK helpers), re-exported by `packages/db/src/schema.ts`, the entry that drizzle-kit, the client, the test databases and `db:drift` read: a new module must be re-exported there — tables: `tenants`, `users`, `client_profiles`, `client_settings`, `push_tokens`, `accounts`, `sessions`, `verification_tokens`, `projects`, `project_documents`, `project_photos`, the construction control's `obra_chapter_progress`, `obra_progress_events`,
  `obra_invoice_requests`, `obra_issues`, `obra_issue_files`, and the obra's `budget_revisions`, `budget_chapters`, `budget_lines`, `obra_hitos`, `obra_hito_chapters`, `obra_hito_checks`, `obra_hito_photos`, `obra_hito_events`, `budget_revision_changes`, `budget_approvals`, plus `budget_generations` (AI runs) and `ai_usage` (one row per Claude call, with its cost), and the
  Subcontratas tables `subcontractors`, `subcontractor_workers`, `subcontractor_documents`, `subcontractor_document_versions`,
  `subcontractor_assignments`, `subcontractor_audit`, Compras' `purchase_orders`, `purchase_order_lines`,
  `purchase_order_events`, `purchase_order_documents`, `purchase_order_document_versions`, `purchase_order_milestones`, `purchase_invoices`, `purchase_invoice_lines`, `purchase_invoice_files`,
  `purchase_payments`, `purchase_requests`, `purchase_request_lines`, `purchase_request_events`, `purchase_order_amendments`, `purchase_document_checks`, Planning's `planning_versions`, `planning_items`, Garantía's `warranty_claims`, `warranty_claim_photos`, `warranty_claim_events`, and `idempotency_keys`, `user_mfa` (`schema_migrations` is the migration runner's, not in `schema.ts`). A project is deliberately minimal — exactly what the mobile app shows: `ref`, `address`, `start_date`, `completion_date`, plus `client_user_id` linking it to its mobile app client (a client may have several)
- **Deletes are soft.** What a user deletes is never erased: a project (admins; it leaves the portal and the client's
  app, whatever it holds), a project document or photo, an incident's file, a subcontractor's assignment to an obra
  (assigning again takes the same row back, and an obra's CAE document counts only while the company is assigned to
  it), an order's document, a supplier's invoice or payment. Each keeps its row
  and its files in the Blob store, with `deleted_at` and `deleted_by_id` (when and who), and **every read leaves it
  out**, as if it were gone: lists, by-id lookups, joins, sums and counters. A new read of one of these 8 tables must
  filter `deleted_at is null`, and a tenant-wide query must also leave out the rows of a deleted project
  (`projectInTenant`, `projectsInTenant`, `projectIdsInTenant`, `projectNotDeleted` and, in raw SQL, `inLiveProject` /
  `inLiveOrder` in `project-client.ts`; a child row read by its own id checks its project too, e.g. `requireOrder`,
  `requireInvoice`, `documentInProject`). A delete writes `softDeleted(ctx)`. A static guard keeps it so
  (`packages/core/test/soft-delete-guard.test.ts`): every production read of a table with `deletedAt` (Drizzle
  `.from`/joins/`$count`, `db.query` and its `with`, raw `sql` naming it; `sql.raw` naming it and a hard `delete`
  always fail) must leave out its deleted rows (`isNull(t.deletedAt)` on that very source, or `alias.deleted_at is
  null` in a where/on of its own select, under no `or`/`not`) and, under a project, a deleted project's (a
  `projects.deleted_at` helper, or narrowed by a value, never a subquery, to one project's rows). A left join's `on`
  counts only for its own table. A read that must see deleted rows names the tables it excuses next to it:
  `// soft-delete-ok(projectDocuments, …): <reason>` (that query only; it fails without a reason, or naming a table
  its query doesn't read or reads correctly). A project's
  ref and a supplier's invoice number are unique among the rows not deleted. Admins see and restore them on
  **Elementos eliminados** (`/dashboard/eliminados`, in the rail's settings menu; `deletedService` in
  `packages/core/src/deleted.ts`: `listDeleted`, `restoreDeleted`; API `GET /api/v1/deleted`, `POST
  /api/v1/deleted/:kind/:id/restore`): a restore passes the same checks as creating the record (`checkOnOrder`,
  `checkPayable` in `purchase-invoices.ts`), is refused while its parent is deleted (`parent_deleted`) or its ref or
  number was reused, and leaves a trace (the order's events, the subcontractor audit, or a `deleted.restored` log line).
  Nothing is ever purged. Drafts (a budget's, a plan's) and rows rewritten while editing are still deleted for real.
  Prod SQL: `packages/db/sql/2026-11-soft-delete.sql`
- Prod migrations are SQL files in `packages/db/sql/` (rules in its `README.md`: additive or expand-then-contract,
  never edit an applied file, new files named `YYYY-MM-DD-HHmm-topic.sql`), recorded once each in the table
  `schema_migrations` by the runner (`packages/db/src/ops/migrate.ts`): `pnpm db:sql:status | db:sql:migrate |
  db:sql:baseline` against `MIGRATE_URL`. `apps/web`'s `build` runs `db:sql:deploy` first: it migrates only when
  `VERCEL_ENV=production` **and** `MIGRATE_ON_DEPLOY=1` (off until set on Vercel; Preview shares production's database
  and never migrates); otherwise it only says how many files are pending. No plain `db:push` on prod. `pnpm db:drift`
  (`DRIFT_URL`, read-only) compares a database with `schema.ts`; accepted leftovers are in `packages/db/drift-allow.json`
- **The database enforces what the app guarantees** (comment "What the database enforces" in `schema.ts`): CHECK
  constraints on every text status/kind column, built from `COLUMN_VALUES` (a new value goes there, in core's constant
  (`packages/core/test/schema-values.test.ts` compares them, and the three ranges of `COLUMN_RANGES`) and in a prod SQL
  file that replaces the constraint), ranges, date order, and `deleted_by_id` only with `deleted_at`;
  **tenant-composite keys**: a row with `tenant_id` references its parent by `(tenant_id, <parent>_id)` against the
  parent's `UNIQUE (id, tenant_id)` (a new child table does the same; `ON DELETE SET NULL` pointers stay single-column);
  and keys to `projects` are NO ACTION, never cascade: a hand-run `DELETE FROM projects` on a project with rows is
  refused, while deleting a whole tenant still works. A constraint added to a table with rows goes in `NOT VALID` and
  is validated on its own, so old rows never fail the file (`pnpm db:drift` lists any left unvalidated), and a file
  that takes table locks starts with `SET LOCAL lock_timeout = '5s'`. `packages/db/test/integrity-migrations.test.ts`
  applies every SQL file newer than `test/fixtures/schema-before-2026-11-15.sql` and expects exactly `schema.ts`.
  `db:push` on an existing local database re-adds the composite keys every time (a drizzle-kit quirk; harmless).
  Prod SQL: `packages/db/sql/2026-11-15-1000-check-constraints.sql`, `-1010-tenant-composite-keys.sql`,
  `-1020-project-fk-no-cascade.sql`

### Operations (errors, health, logs)

- Pages: `read()` in `app/actions/run.ts` sends a signed-out user to the login page, a missing record to
  `notFound()` and a forbidden one to `/dashboard/forbidden` (`lib/access.ts`: `requireSession`, `forbidden`); it
  returns null for a 404 only with `{ optional: true }` (something missing the page expects: no draft yet, a stale
  `?revision=`), and always for any other `CoreError` (the 400/409 class: neither 403 nor 404), which the page must
  handle (`if (!result) notFound()`); what is not a `CoreError` is thrown, to the error page. Don't `redirect` on a missing record. `error.tsx`, `not-found.tsx` and
  `loading.tsx` exist at the root and under `dashboard/` (text in `errorPages`); an error page shows the digest, never
  the error's message
- `GET /api/health` (no session, `proxy.ts` lets it through; `healthService` in core): `status` ok | degraded | down
  (503), `commit`, `checks` `db`, `ai` (`attention`: a budget generation failed in 24 h, a document check pending over
  an hour, or a tenant at 90 % of its AI limit) and `migrations` (`untracked` until `schema_migrations` exists). No
  figures, no tenant data; one result is shared for 10 s per instance (2 s when down), each check time-limited in the
  database
- Runbooks: `doc/ops/` (deploy, rollback, database, incident, secrets, capacity, mobile-release)
- Logs: one JSON line per event on stderr (`logError` / `logWarn` in `@repo/core/log` and `apps/web/lib/log.ts`;
  `instrumentation.ts` › `onRequestError` for unhandled server errors). Never a body, cookie, header, email or query
  string. An API 500 answers `{ "error": "internal_error", "id" }` and logs the same id. No `console.*` in app code
- Security headers: `apps/web/lib/security-headers.js` is the one place. `next.config.js` sends `BASE_HEADERS`
  (nosniff, HSTS, referrer and permissions policy) on everything and `PAGE_HEADERS` (X-Frame-Options DENY + the
  enforced `PAGE_CSP`) on pages; on `/api` only `BASE_HEADERS`, because a header set there wins over a route's own.
  API JSON goes through `apiJson` / `noContent` (`lib/responses.ts`: `default-src 'none'; frame-ancestors 'none'`) and
  files through `fileResponse`, whose headers come from `fileHeaders(contentType)`: a PDF gets only `frame-ancestors
  'self'` (a `default-src` would reach the browser's PDF viewer), anything else `default-src 'none'; frame-ancestors
  'self'`; both `X-Frame-Options: SAMEORIGIN` and nosniff. Never `NextResponse.json` in a route
- Pages' script policy: `proxy.ts` sends `pagePolicy(nonce)` with a fresh nonce per request, **report-only** while
  `ENFORCE_SCRIPT_POLICY` is false. Next reads the nonce from the request header and puts it on its scripts, so pages
  must stay dynamic (a static page would carry none). Violations go to `POST /api/csp-report` (no session,
  rate-limited, nothing stored; one `csp.violation` warn line with a known directive name, the blocked origin or a
  fixed keyword, and the path). Enforce by setting that constant once the log is quiet; a new origin the portal loads
  must be added to `pagePolicy`

- Retries: the six creates that make a numbered or money record (a supplier payment, invoice or credit note, an
  order, a purchase request, a modificado, an incident) take an idempotency key (`Idempotency-Key` header or
  `idempotencyKey` in the body; `idempotent` in `packages/core/src/idempotency.ts`, table `idempotency_keys`,
  kept 7 days): the same key answers with the first result and creates nothing; with a different request it is 409
  `idempotency_key_reused`. The portal's forms send one (`useIdempotencyKey`). Optional: without a key a create runs as
  before, and so does a keyed one while the table is missing (code deployed ahead of its SQL: a warning, not a 500;
  the MFA endpoints then answer `mfa_unavailable`). A new create of that kind must use it. Prod SQL: `packages/db/sql/2026-11-14-1700-idempotency-keys.sql`
- Lists: tenant-wide lists are paged and filtered on the server (`packages/core/src/paging.ts`; orders, supplier
  invoices, payments, workers: `?page=` and the filters in the URL, `components/ui/pager.tsx`, `useListQuery`), with
  their counts and totals computed in SQL for the whole filtered set. `/api/v1` without `?page`/`?limit` answers as
  before, capped. Don't load a tenant's whole table to filter it in the browser. Measured at ten times a realistic
  volume in `doc/ops/capacity.md` (`pnpm db:seed:volume` into a local scratch database, `pnpm db:bench`)

### Obra (construction process)

- The process is `features/construction_process/PROCESS.md`: 8 stages (`projects.obra_stage`), a
  budget in the FRAMER model, and payment hitos H0–H9. Designs: `doc/mobile-app-design/A-Progress|A-Fase|A-Obra-Pagos|A-Hito`
  and `doc/platform-design/P-*`
- The stage moves **up on its own**, never down (`obra-stage.ts` › `raiseStage`, rule `stageEvidence` in `obra-calc.ts`):
  2 a budget input registered, 3 a budget revision (by hand or the AI), 4 a revision accepted, 5 H0 paid, 6 a contract
  chapter started on Avance, 7 every contract chapter finished, 8 H9 paid. Each of those writes calls `raiseStage`
  after it (a new one that adds evidence must too); it marks `obra` when it moves. Staff can still set it by hand,
  up or down; the next event brings a lowered one back up. `getObra`'s `stageEvidence` dates each, shown under the
  stepper. Prod SQL (catch-up, after deploying): `packages/db/sql/2026-11-obra-stage-auto.sql`
- Budget (`packages/core/src/budget.ts`): revisions → chapters → lines (partidas), money in cents, quantities in
  thousandths. Staff then record each line's executed %; a change is a new revision (copied, compared with the
  previous). Only the accepted revision drives prices and progress. The budget itself is under "Budget" below
- Hitos (`hitos.ts`): every project starts with the standard plan (`obra-template.ts`); staff set each hito's % and the
  chapter codes it closes. The acta is signed on paper; staff upload it and the invoice (PDFs), then record the payment
  (a day up to today, at least 1 cent). Every acta, invoice and payment registered, corrected or cancelled is logged in
  `obra_hito_events` (append-only: who, when, what was there before) and no PDF is deleted: a replaced or removed one
  stays in the Blob store, its pathname in the event. `getHito` returns the history (`events`) for the portal's hito
  page (Historial); staff-only, never in the hito list nor in `/api/mobile`. Prod SQL: `packages/db/sql/2026-11-hito-events.sql`
- `obra.ts` builds the portal's Obra page and the app's phases (pre-construction + one per hito); the arithmetic
  (progress, due dates, penalty, phases) is pure in `obra-calc.ts`, also used by the portal for live figures
- Portal tabs Obra (construction control, below), Presupuesto and Pagos (`payments/[hitoId]`); the stage stepper is on
  the project's General tab; app tab Obra with pushed screens under `app/(app)/obra/`. `pnpm db:seed` gives VTH-26-001 the real Caviedes budget (`seed/caviedes.ts`), its obra half built

### Construction control (the Obra tab)

- Requirements CC-01…CC-63: Claude Doc https://claude.ai/code/artifact/f9eda39b-0206-45a9-aea0-4cef149bab16; design canvas
  https://claude.ai/code/artifact/95ac23ac-b528-4711-91fb-a658bfcd1589 (Resumen, Avance, Capítulo, Finalizar, Costes, Hitos,
  Incidencias, Fotos, Avance at 390 px)
- Service `packages/core/src/construction.ts` (`constructionService`), pure rules in `control-calc.ts`. The "main budget
  items" are the contract's chapters at cost (chosen options too), never chapter 20 (contingency reserve). A chapter is
  pending → in progress → finished **only** by the actual dates staff record (`obra_chapter_progress`; start/finish
  dates may be before today, never after); every record and correction is kept in `obra_progress_events`. Passing a
  planned date never changes anything
- Whether an obra is on time has **one definition**: `scheduleStatus` in `packages/core/src/schedule-status.ts` (pure,
  in `@repo/core/contract`): with the approved baseline, `late` when a pending chapter is past its planned start, a chapter in progress past
  its planned end, or the forecast ends after the contract date, else `on_time`; `simulated` without a baseline (never
  on time or late); `no_dates`. Resumen, Planificación (`ScheduleStatusView`) and the project list all read it; never
  compute it apart
- Finishing the last chapter of a hito creates one `obra_invoice_requests` row for Administration (unique per hito:
  never a second one, whatever is corrected); hito states pending → reached → requested → invoiced → collected follow
  the Pagos tab's invoice and payment. `Hito.invoiceRequestedAt` shows it on Pagos. A finished chapter counts as 100 %
  built for the hitos and the client's app (`loadObra`), so start/finish/correct call `markChanged(["obra"])`
- Planned dates are the approved Planning baseline (`loadObra`'s `planDates`, below; `sources.planning: "live"`). A
  project without one has them **simulated** in `control-calc.ts` (hitos in turn, each a share of the works' time like
  its share of the price; `"mock"`, shown as "Simulado"). Contracted amounts are real, from Compras (`lineContracts` in
  `purchasing.ts`, below); a late delivery is a warning only. Sales is the hitos' invoices/payments
- Issues and changes log (`obra_issues`, numbered per kind INC-/CAM-, files in `obra_issue_files`, private Blob,
  served as downloads): history only, never changes dates, amounts or invoices. Document warnings come from
  Subcontratas (`listProjectAttention`). Photos have a `taken_on` day. Staff only; viewers read
- Portal: `dashboard/projects/[id]/obra/` (Resumen) + `planificacion` (Planning, below), `avance`, `avance/[code]`, `costes`, `hitos`, `incidencias`,
  `fotos` (the old project Fotos tab redirects there); views in `components/construction/`. API: `/api/v1/projects/:id/obra/`
  `control`, `header`, `costs`, `review`, `chapters/:code/{control,start,finish}` (`PATCH …/control` corrects), `issues`,
  `issues/:issueId`, `issues/:issueId/files[/:fileId]`. Prod SQL: `packages/db/sql/2026-10-construction-control.sql`

### Purchasing (Compras)

- Design canvas https://claude.ai/code/artifact/4ce3f46d-d759-45c5-9dda-cc9828f77222. Service
  `packages/core/src/purchasing.ts` (`purchasingService`); web-only and staff-only (admins/managers write, viewers read):
  the client never sees it, so no `/api/mobile` route and no `markChanged`
- A project's orders (`purchase_orders`, numbered per project PED-001, retried on conflict): `material` (pending →
  ordered → confirmed → in_transit → delivered) or `subcontract` (pending → contracted → finished); any may be cancelled
  except a completed one; any status of its kind can be set again (corrections), dates ≤ today. Each order splits its
  amount across budget lines by **lineage** (`purchase_order_lines`, so it outlives a revision) and may close a line
  (`closes_line`: nothing more to order for it). Every change goes to `purchase_order_events`. An order has several
  documents (the order, the signed contract, annexes…: `purchase_order_documents`), each a PDF in versions
  (`purchase_order_document_versions`, a note says why one replaced the last; a document goes with all its versions),
  in `purchase-documents.ts` (`purchaseDocumentsService`). `purchase_orders.file_*` is the legacy single PDF, copied
  into a first document by the prod SQL; `/api/v1/purchases/:orderId/file` still serves the first document
- A line's contracted amount = its orders from ordered/contracted on (pending and cancelled don't count); its
  deviation (contracted − cost: positive is an overrun, negative a saving) counts only once it is closed, so an open line never shows as a saving. The Obra tab's
  Costes/Resumen read it; a material order past its expected date and not delivered is a late delivery (warning only)
- Suppliers are the Subcontratas companies; a material supplier is `subcontractors.supplies_only` (no CAE documents,
  workers or obras: always apta; it can't take a subcontract)
- Supplier invoices and payments (`packages/core/src/purchase-invoices.ts`, `purchaseInvoicesService`; arithmetic pure in
  `purchase-calc.ts`, loading shared in `purchase-invoice-data.ts`): Administration registers each invoice once against a
  placed order (`purchase_invoices`, number unique per supplier): its base without VAT split across the order's lines
  (`purchase_invoice_lines`, in proportion unless given), VAT (`vat21`/`vat10`/`reverse_charge`/`exempt`), IRPF and the
  guarantee retention, and its PDF in versions (`purchase_invoice_files`, none deleted). The order holds the defaults
  (`payment_days` 30, `retention_bp`, `vat_kind`: a subcontract is reverse-charged) and an optional payment schedule
  (`purchase_order_milestones`, adding up to its amount; an invoice then goes to one milestone, an invoiced one is locked).
  A credit note rectifies one invoice of its order (negative base) and settles against it. Payments (`purchase_payments`,
  partial, with an optional proof) go up to what is due, then release the retention. Invoice states pending → partial →
  overdue → paid (`credit` for a credit note). An invoiced order keeps its supplier, its invoiced lines and its place
  (`has_invoices`). Every change goes to `purchase_order_events` (`detail.invoiceId`)
- Purchase requests (Solicitudes, `packages/core/src/purchase-requests.ts`, `purchaseRequestsService`): before an order,
  the obra (admins/managers) asks for material or a subcontract on some contract lines with an estimate
  (`purchase_requests` numbered per project SOL-001, `purchase_request_lines` by lineage), a needed-by day and maybe a
  supplier. Pending → approved or rejected (admins only; a reason to reject) → ordered, or cancelled while open; edited
  only while pending. `createPurchase({ requestId })` makes the order from an approved one in the same transaction and
  links them (`purchase_requests.order_id`, once only; cancelling that order approves the request again, unlinked); orders can still be made without one. A request contracts
  nothing. Every change goes to `purchase_request_events`
- Modificados (`packages/core/src/purchase-amendments.ts`, `purchaseAmendmentsService`; loader in
  `purchase-amendment-data.ts`): a placed order changes formally by a numbered modificado (`purchase_order_amendments`:
  reason, signed day ≤ today, amounts before and after, the line changes, optionally its signed PDF as one of the
  order's documents). It rewrites the order's lines like an edit (`replaceOrderLines`: invoiced lines stay, never below what
  they invoiced, `below_invoiced`; `no_changes` if nothing moves) and keeps a payment schedule adding up (a rise is a
  milestone of its own, a cut comes off the last ones not invoiced). The order keeps its `amendments` and
  `originalAmountCents` (its amount less what they changed; edits are corrections). Signed between the order's date and today. A pending order is just edited. An edit
  that changes the amount (`updatePurchase`) moves the schedule the same way (`followSchedule` in `purchasing.ts`; the
  new milestone is "Ajuste por corrección del pedido"), or fails with `milestones_cut` and changes nothing (as a modificado does). Portal: the order page's
  Modificados card and `compras/[orderId]/modificado`; API `POST /api/v1/purchases/:orderId/amendments` (JSON or
  multipart with `data` + `file`)
- AI review of purchase documents (`packages/core/src/purchase-document-checks.ts`, `purchaseChecksService`; loader
  `purchase-check-data.ts`): every PDF of Compras (an order document's version, an invoice's PDF, a payment's proof) gets a
  `purchase_document_checks` row: the same file uploaded before (SHA-256) and Claude (`MODELS.checker`, Haiku 4.5, the PDF
  + its record's facts, the modificados included) warning of a wrong document, another obra, another supplier, amounts, dates or numbers that don't
  match, unreadable or inconsistent. Warnings only: it never blocks, moves, deletes or changes anything. An upload queues
  it (`queueNewChecks`, files of the last day) and `runPendingChecks` reviews it after the response (`lib/review-documents.ts`
  › `after()`; `mutateDashboard(…, { review: true })` in actions, `reviewed(ctx, …)` in the upload routes); a run drains the
  queue for a few minutes and takes again checks cut off. Within `tenants.ai_monthly_limit_cents` (`ai-limit.ts`, checked
  before each call; past it only duplicates, `skipped`, retried once there is room), each call in `ai_usage` (`purchase.check`). Order and
  invoice pages show `checks` (re-read while one runs); staff mark one as seen or ask again
  (`POST /api/v1/purchases/checks/:checkId/{dismiss,recheck}`). Tests mock `budget-ai/claude`
- Suppliers (Compras › Proveedores, `packages/core/src/purchase-suppliers.ts`, `purchaseSuppliersService`): every
  Subcontratas company as a supplier, read-only: its orders across the obras, contracted, invoiced and paid (without VAT,
  as compared with the cost), owed and past due (with VAT: what Administration pays), retention held, those owed first. Data and CAE stay on its Subcontratas ficha.
  Portal `dashboard/compras/proveedores/` (+ `[id]`: its orders, invoices and payments); API `/api/v1/purchases/suppliers`
  (GET) and `…/suppliers/:subcontractorId` (GET)
- The obra's Compras by budget line (`getProjectPurchaseLines`) gives each line one of four states
  (`PURCHASE_PROGRESS`): to_contract → contracted → invoiced → paid (closed, all invoiced, nothing owed; retention
  aside), with its orders, their milestones and invoices; money there is without VAT (`settle`'s `base`)
- The project's Compras list views open with an obra picker at the top (`compras/page.tsx` › `ComprasObraBar`,
  `projects/components/ObraPicker` + `obra-options.ts`), and choosing another obra keeps the view (`?vista=`). Its data
  is the project list (`GET /api/v1/projects`). The rail's old Proyectos › "Compras de obra"
  (`dashboard/projects/compras`) now redirects to the project list
- Portal: the project tab opens by budget line (`compras`, `PurchaseLinesScreen`; `?vista=solicitudes` the requests,
  `?vista=pedidos` the orders list); a request's page `compras/solicitudes/[requestId]` (+ `editar`, `solicitudes/nueva`)
  decides it and opens the order form on it (`nuevo?solicitud=`); an order's page shows its milestones (editable) and
  invoices. The rail's Compras has Solicitudes (with those to approve) · Pedidos · Facturas · Pagos · Proveedores
  (`dashboard/compras/`, `solicitudes/`, `facturas/` list, `facturas/nueva` form with `?pedido=` and `?abono=` for a credit note,
  `facturas/[invoiceId]` + `editar`, `pagos/` forecast and payments) with a badge for invoices due within a week.
  Actions `app/actions/purchase-invoices.ts`; API `/api/v1/purchases/invoices` (GET), `/api/v1/purchases/:orderId/invoices`
  (POST JSON, or multipart with the fields as JSON in `data` and the PDF in `file`), `…/invoices/form`, `…/invoices/:invoiceId` (GET, PATCH, DELETE), `…/file` (GET `?fileId`, POST a version),
  `…/payments` (POST), `/api/v1/purchases/payments` (GET), `…/payments/:paymentId` (DELETE) and `…/file`,
  `/api/v1/purchases/:orderId/milestones` (PUT), `/api/v1/purchases/counts`, `/api/v1/projects/:id/purchases/lines`.
  Requests: actions `app/actions/purchase-requests.ts`; API `/api/v1/purchases/requests` (GET `?projectId`),
  `…/requests/:requestId` (GET, PATCH), `…/decision` (POST), `…/cancel` (POST), `/api/v1/projects/:id/purchases/requests`
  (POST); an order takes `requestId` on POST `/api/v1/projects/:id/purchases`
- Portal: project tab Compras (`dashboard/projects/[id]/compras/`: list, `nuevo`, `[orderId]`, `[orderId]/editar`) and the
  rail's company-wide Compras (`dashboard/compras/`, every order of the tenant for Administration). API: `/api/v1/purchases`
  (`?projectId`, `?subcontractorId`), `/api/v1/purchases/:orderId` (GET, PATCH), `…/status` (POST), `…/file`,
  `…/documents` (POST), `…/documents/:documentId` (GET `?versionId`, POST a version, DELETE);
  `/api/v1/projects/:id/purchases` (GET, POST) and `…/purchases/form`. `pnpm db:seed` gives VTH-26-001 its orders
  (`seed/purchasing.ts`), their invoices and payments (`seed/purchase-invoices.ts`) and three requests
  (`seed/purchase-requests.ts`). Prod SQL:
  `packages/db/sql/2026-10-purchasing.sql`, `packages/db/sql/2026-10-purchase-invoices.sql`,
  `packages/db/sql/2026-10-purchase-documents.sql`, `packages/db/sql/2026-10-purchase-requests.sql`,
  `packages/db/sql/2026-10-purchase-amendments.sql`,
  `packages/db/sql/2026-10-purchase-document-checks.sql`

### Planning (Planificación)

- Design canvas https://claude.ai/artifact/JtbTern7qQ7gT7rcBWsLD6. Service `packages/core/src/planning.ts`
  (`planningService`), arithmetic in `planning-calc.ts` (pure, also run by the portal as staff type); staff-only
  (admins/managers write, viewers read). The client's app sees only the approved baseline: its first start and last end
  are the dates the client is told (`startDate`/`completionDate` of `/api/mobile/project` and of `/api/mobile/obra`'s
  `term`; else the project's dates, `clientDates` in `planning-calc.ts`) and each phase's `plannedEnd`. Approving marks `obra` + `project`, and pushes "Nueva fecha de entrega"
  (progress toggle, opens Obra) when the handover moves. Drafts never reach the app
- A project's schedule by version (`planning_versions`: one `draft` and one `approved` at most, the older ones
  `superseded`). Each contract chapter (20 aside) is a `planning_items` row: it starts the working day after the chapter
  it waits for ends (`after_code` + `lag_days`, negative to overlap), else on `fixed_start` or the works' start, and lasts
  `duration_days` working days; 17–19 span the works (`spans_works`). The dates are stored, so a baseline never moves
- Working days: weekends, national holidays (Good Friday too), the region's (`as cb cl ga md`, plus Holy Thursday),
  and the optional August (4 weeks from its first Monday) and Christmas (24/12–6/1) closures, chosen per version
- What Avance records wins: a finished chapter keeps its real dates, a started one its real start; nothing still to
  happen is placed before today. The baseline view adds that forecast and the critical path; both, and the draft, are
  checked against `projects.completion_date` with the contract's delay penalty (`delayPenaltyCents` in `obra-calc.ts`)
- Each chapter also has a lead time (`lead_days`, calendar days): its orders must go out by planned start − lead
  time. Compras' "Por contratar pronto" lists the chapters with lines not ordered whose order-by date falls within
  `UPCOMING_DAYS` (30) or has passed (`orderLateDays`), soonest first; without a baseline the template's lead times
  (`templateLeadDays`) apply to the simulated dates. Prod SQL: `packages/db/sql/2026-10-planning-lead-times.sql`
- A first plan comes from the standard steel-frame template (`PLAN_TEMPLATE`) or another project's baseline; a change
  copies the baseline into a draft and needs a reason to approve. Approving recomputes the dates as of that day
- Portal: Obra tab Planificación (`dashboard/projects/[id]/obra/planificacion/`: the baseline or the generate form,
  `editar` the draft, `versiones` the history); views in `components/planning/`. API: `/api/v1/projects/:id/planning`
  (GET), `…/planning/versions` (GET), `…/planning/draft` (GET, POST create, PUT save, DELETE discard) and
  `…/planning/draft/approve` (POST). `pnpm db:seed` approves VTH-26-001's first plan (`seed/planning.ts`). Prod SQL:
  `packages/db/sql/2026-10-planning.sql`

### Budget (Presupuesto)

- Spec: `features/budget/TECH_DESIGN.md` (decisions in §17); PDF template and AI prompts in the same folder
- Lines are priced at **cost**; gastos asociados (`overhead_bp`, a markup on the cost) and beneficio industrial
  (`profit_bp`, a margin on the selling price), default 16 % + 6 % (§18; prod SQL for the drafts at 13 %: `packages/db/sql/2026-11-budget-overhead-16.sql`), go into each unit price: price = cost ×
  (1 + gastos) ÷ (1 − beneficio), as in the client's document "Fórmulas margen obra". The PEC is the sum of the
  priced lines (`priceLines` in `obra-calc.ts`, `linesPriceSql` in SQL). Only the portal's summary shows the margins apart; the PDFs (`forClient`), obra, hitos and
  app see the priced lines
- Model `framer20`: always the 20 fixed chapters 01–20 (`budget-template.ts`); chapter 20 is one computed line,
  `contingency_bp` × chapters 01–19, kept in sync by `syncDraft` (`budget-draft.ts`) inside every draft write.
  Options live below as `budget_chapters` with `kind = 'option'` (codes OP1, OP2…, lines numbered OP.01… across
  all options, renumbered automatically); they may subtract (deductions, alternatives). Lines can come from the fixed
  FRAMER 2026 price base (`price-base-data.ts`, unit costs, searched with `searchPriceBase`) or be "estimated"
- Status: draft → issued (frozen; both PDFs stored as project documents) → accepted or rejected; an older revision is
  superseded when a later one is accepted. One draft at a time; from Rev.1 issuing needs a `changeReason`.
  Accepting records the options the client chose: contract price = PEC + chosen options (at price), and that is what the obra,
  hitos H0–H9 and the app use (`inContract` in `obra-data.ts`). Accepting keeps its proof: the day the client accepted
  (from the issue day to today), the staff user who registered it (`accepted_by_user_id`) and the client's signed copy
  linked to the revision (`accepted_document_id`). A draft is refused (`not_issued`) from the portal and `/api/v1`;
  `acceptRevision`'s `options.unissued` is only for a contract signed outside the platform (the seed) and test
  fixtures. Prod SQL: `packages/db/sql/2026-11-budget-acceptance.sql`
- PDFs (`budget-pdf/`, `@react-pdf/renderer`, DejaVu Sans embedded): general and detailed, rendered by
  `budget-issue.ts`; a draft's are rendered on the fly with a "BORRADOR" watermark. The general one is shared with the
  client by default; the detailed one stays staff-only. Issued PDFs can't be deleted
- First draft by AI (`budget-ai/`): up to four inputs (plans, basic project, execution project, measurements as
  PDF/XLSX/BC3), uploaded straight from the browser to the private Blob store (`documents/uploads`, ≤ 100 MB) and
  registered as staff-only project documents. A durable Vercel Workflow (`apps/web/workflows/generate-budget.ts`,
  started by `lib/budget-generation.ts`) runs: read the project (`claude-opus-5-5`, Files API), then chapters in four
  groups (`claude-sonnet-5-5`), then saves Rev.0. The portal polls the run's log. `tenants.ai_monthly_limit_cents`
  caps spend (null = no limit). Tests mock `budget-ai/claude` — never call the real API in tests
- Review checks (`budget-review.ts`): the AI's inconsistencies and assumptions, estimated lines and chapters off the
  tenant's own €/m² averages; staff tick them off before issuing
- Client and address (`budget-identity.ts`): the project is the source of truth. A new draft (by hand, AI, copied
  revision) names the project's address and its client (profile's first name + surnames) on the cover's promoter and
  site, keeping a text that already names them and says more (accents, case, punctuation aside); the AI's or old text
  only where the project has none. `revision.identity` shows a draft's differences (notice on Texts, one line on the
  summary; `takeProjectData`, `POST …/revisions/:revisionId/project-data`); issued revisions only get a note. Never
  writes to the project
- Portal: Budget tab pages under `dashboard/projects/[id]/budget/` (summary, lines, options, texts, conditions,
  pdf; `?revision=` shows an older one, picked from the menu on the revision pill); `BudgetScreen` / `BudgetStartScreen` are the containers, views in
  `components/budget/`. Web-only: the app only sees the general PDF (Documentos), the contract via the obra and a
  change it is asked to approve (below)
- Every obra's budget: core `budget-overview.ts` (`listBudgets`: each obra's newest revision at its price, what it
  waits for and the totals; pure rules in `budget-overview-rules.ts` via `@repo/core/contract`), served only by
  `GET /api/v1/budgets` now; the portal's project list filters by the budget instead (below). No obra switcher beside a
  budget (removed: too much space); the budget pages (route group `budget/(obras)/`, no layout of its own) go back with
  the project's "Volver a proyectos". The old Proyectos › Presupuestos page (`dashboard/projects/presupuestos`)
  redirects to the project list. Staff-only, read-only, web-only
- Changes to the contract and the client's consent (core `budget-approvals.ts`, `budgetApprovalsService`): staff link
  the changes (CAM-, `obra_issues` of kind change) a revision from Rev.1 on prices (`budget_revision_changes`, a link
  table: a change may be priced again by the revision reworked from a rejected one), seen on the Budget's summary and
  on the change (Obra › Incidencias, `ObraIssue.revisions`). On the newest issued revision of a project with an
  accepted contract and an app client, admins/managers ask the client to approve it in the app (`budget_approvals`:
  one pending per revision; message, options proposed as chosen, the contract before and after without VAT, VAT rate,
  the general PDF and a copy of the linked changes (`changes`), all fixed when asked: the portal and the app read the
  copy while a request waits or stands approved; the PDF is shown to the client if it wasn't and can't be hidden
  meanwhile (`approval_document`); push `approval` on the "Mensajes del equipo" toggle; links frozen from then on).
  The client approves with their password (`checkOwnPassword` in `accounts.ts`, the password-change throttle) or
  rejects with a reason, once (the same answer sent again gets what was recorded); the answer is written once with
  who and when, never edited, no IP or device. **It is evidence, not the acceptance**: the revision stays issued until
  staff register it; the accept dialog starts from the approval's day and options, and `acceptRevision` files it as
  proof (`budget_revisions.accepted_approval_id`) when the options accepted are the ones approved by the project's
  client now. A pending request closes (`withdrawn` by staff, or `lapsed`) when a later revision is issued, staff
  accept/reject one by hand, the project's client changes (`project-client.ts`) or the project is deleted; an answered
  one stays. Asking, issuing, accepting, rejecting and changing the client lock the project's row (`lockProjectRow`),
  first, then the revision; only issuing takes it last, for its writes alone, never while the PDFs render and upload. Code from before this does not lapse requests: after a rollback past it, close the waiting ones
  (`doc/ops/rollback.md`). Every write the app sees marks `obra` (the app reloads the card with the obra). Portal: the
  Budget summary's "Cambios de obra y aprobación del cliente" card (`ChangeApprovalCard`, `AskApprovalDialog`). API:
  `/api/v1/projects/:id/budget/revisions/:revisionId/approval` (POST ask, DELETE withdraw),
  `…/revisions/:revisionId/changes/:issueId` (PUT link, DELETE unlink); app: `GET /api/mobile/approvals`
  (`?projectId=`), `POST /api/mobile/approvals/:id/decision`, Inicio's card and `app/(app)/aprobacion.tsx`. Prod
  SQL: `packages/db/sql/2026-11-15-1430-budget-approvals.sql`

### Project list (Proyectos)

- `dashboard/projects` (`ProjectsListClient` container, views `components/ProjectFilterBar` + `ProjectsTable`, pure
  `project-list.ts`): every project with three filters, kept in the URL (`?presupuesto=&obra=&atencion=&q=`, replaced, not pushed;
  read with `useSearchParams`, so the browser's back and the rail's Proyectos win; the project layout's "Volver a
  proyectos", `ProjectsBackLink`, returns to the list as last filtered in the tab):
  **Presupuesto** by the newest revision's state (`BUDGET_FILTERS`/`budgetFilterOf`; the AI drafting counts as a draft)
  and **Obra** by the project's stage (`OBRA_FILTERS`/`obraFilterOf` in core `project-filters.ts`: stages 1–5 not
  started, 6 under construction, 7–8 finished) and **Atención** (`ATTENTION_FILTERS`: all, needs attention = late or a
  reason, late; with it on, most urgent first, `byUrgency`). Each option counts given the other filters and the search. The data is
  core `listProjectsWithBudget` (`budget-overview.ts`: each project with its `BudgetState`, the newest revision and AI
  run, none of the overview's figures, and with `{ signals: true }` its signals from `project-signals.ts`), also
  `GET /api/v1/projects` (the `budget` field; `schedule`, `progressPct` and `attention` only with `?signals=1`). The
  signals, for every project in a fixed 15 queries sent at once (`loadObraSummaries`: each chapter's line totals summed
  in SQL, no lines; `countProjectsAttention`; never a query per project, never a list of document ids): with a contract, the
  schedule (`scheduleStatus` as Obra › Resumen, via `projectSchedule`) and the built %; and the reasons: hitos to
  invoice (reached/requested), hito payments past due, supplier invoices overdue (with what they owe), purchase
  requests to approve, late material deliveries, CAE document warnings. Rows add the budget pill
  (opens the budget; a failed AI run says so, filed under no budget, not an attention reason), the stage pill
  (`StagePill`, opens Obra), the schedule pill (opens Planificación), the built % and the attention count (a popover
  whose reasons link to where each is handled; `components/ProjectSignals.tsx`); a table from 768 px (the dates from
  1280 px), cards (the reasons as text) and a `FilterSelect` per filter below 640 px. The rail's Proyectos has no sections of its
  own. Web-only: the client's app has no project list

### Subcontratas (CAE)

- Companies (and self-employed) working on the obras, their workers and the CAE documents asked of them (RD 171/2004,
  Ley 32/2006). Web-only and staff-only: the client never sees it, so no `/api/mobile` route and no `markChanged`
- Pure rules in `packages/core/src/subcontractor-rules.ts` (re-exported by `@repo/core/contract`, also run in the
  browser): the document template `SUBCONTRACTOR_REQUIREMENTS` (stable ids, validity), expiry (`docState`; alert 30
  days before, 7 for monthly documents), company status (`companyStatus`: apta / pendiente / bloqueada — computed; its
  stored copy is below), worker access (`workerAccess`: the six rules, with reasons), CIF/NIF/NIE check digits, masking, REA region
  from the postal code. Services: `subcontractors.ts` (companies, documents, obra assignments, overview, CAE dossier
  ZIP) and `subcontractor-workers.ts`; both load the tenant's whole network at once (`subcontractor-network.ts`)
- The rules' result is also **stored** (`packages/core/src/subcontractor-attention.ts`): `subcontractors.cae_status`
  and `subcontractor_assignments.cae_warnings` (the warnings that company gives that obra, as `listProjectAttention`
  counts them), each with `cae_valid_until`, the last day it holds before an expiry or alert window could change it
  (`nextStateChange`; `9999-12-31` = never; null = not worked out yet). The TS rules stay the one definition: SQL never
  re-implements them. Every write to a company's CAE data (company, documents and versions, workers, assignments) runs
  in `caeTransaction(tenantId, ids, …)`: company rows locked first (`no key update`, id order), values refreshed before
  commit. A new write path must use it; anything writing past the services (seeds, a test's direct `db.update`) calls
  `forgetCae`. Reads refresh stale values themselves (`refreshStale`, any role, no audit or `markChanged`). Only live
  assignments carry values. The project list's count (`countProjectsAttention`) is one grouped sum and reads no
  document once values are fresh; nothing reads the stored status yet (the lists still compute it): read it only after
  `refreshStale`. Code from before this change does not maintain the values: after a rollback past it, or after an
  older branch's Preview edited Subcontratas data (Preview shares production's database), clear the `cae_*` columns
  (`doc/ops/rollback.md`). Prod SQL: `packages/db/sql/2026-11-15-0900-cae-stored-status.sql`, applied **before** the
  code goes live (every read of those tables names the columns)
- Documents are versioned: an upload adds an immutable version (private Blob store); validate / reject (with reason)
  act on the current one. Every write goes to `subcontractor_audit` (the ficha's Historial)
- Admins and managers (contractor, jefe de obra) write; viewers read with masked CIF/DNI. No subcontractor portal login yet
- A material supplier (`supplies_only`, for Compras) has no CAE: no documents, workers or obra assignments
  (`supplies_only` error), never in the attention list or the status counts
- Portal: rail group "Red" › Subcontratas (`dashboard/subcontratas/`: `empresas`, `empresas/nueva` wizard,
  `empresas/[id]` ficha + `editar`, `trabajadores`, `trabajadores/nuevo`, `trabajadores/[id]`); API `/api/v1/subcontractors/**`.
  `pnpm db:seed` adds eight fictional companies on VTH-26-001. Prod SQL: `packages/db/sql/2026-10-subcontractors.sql`

### App errors and releases (apps/mobile)

- The app reports its own errors to `POST /api/mobile/client-error` (with or without a token; one `mobile.client_error`
  log line, nothing stored, rate-limited per instance): a render error caught by the root error boundary, an uncaught
  JS error, an unhandled rejection, a missing translation key (`lib/report-error.ts`: once per error per session, never
  a token, an email or project data; silent in dev, Expo Go and tests). No third-party SDK
- Every request times out (`lib/api.ts`: 15 s, 90 s for downloads) and maps to `network_error` | `timeout` |
  `server_error` | `unauthorized`; screens show the matching message, never "wrong password" for a network failure. A
  status the app doesn't know (from a newer server) is left out, never shown as "undefined"
- `expo-updates` is configured (`runtimeVersion` policy `appVersion`: raise `version` with any native change) so a
  store build can take a JS-only fix; not yet proven on a device. `version` is 1.1.0 since `expo-image-picker` (native)
  came in with Garantía: that release needs a new store build, never an update to 1.0.0. Releases: `doc/ops/mobile-release.md`
- Store-release bits (web + app): Perfil's "Ayuda" and "Privacidad" rows show only when the build sets
  `EXPO_PUBLIC_HELP_URL` / `EXPO_PUBLIC_PRIVACY_URL` (https, `eas.json` env; `constants/links.ts`), opened in the
  browser (`Linking`). Sign-in's "¿Has olvidado tu contraseña?" unfolds a note: the builder sets a new password on
  Clientes (no reset email). "Mensajes del equipo" (Perfil's third toggle) lets through the pushes of a change to approve and of a warranty answer
- Asking for the account to be deleted (the stores want it in-app; accounts are the builder's, so it is only a
  request): `users.deletion_requested_at` (clients only, `users_deletion_request_check`; on `users`, not
  `client_profiles`, because every client has a `users` row and the request is about the login). Core
  `clientAccountService.requestDeletion` (idempotent: the first date stays) / `withdrawDeletion`, only for an active
  client; `POST`/`DELETE /api/mobile/account/deletion-request`, and `deletionRequestedAt` on `GET /api/mobile/settings`
  (absent from older servers: the app then shows nothing). App: a quiet row at the foot of Perfil → pushed screen
  `app/account-deletion.tsx`; once asked, Perfil says since when and offers to withdraw. Portal: Clientes shows a
  "Baja solicitada · date" pill (`GET /api/v1/clients` › `deletionRequestedAt`); "Marcar como atendida"
  (`clientsService.clearDeletionRequest`, admin, `DELETE /api/v1/clients/:id/deletion-request`) only clears it.
  Nothing is deleted or deactivated automatically (the portal has no client deactivation yet). One
  `client.deletion_request` warn line (`action` requested | withdrawn | cleared, ids only). Prod SQL (before the
  code): `packages/db/sql/2026-11-15-1400-client-deletion-request.sql`

### Live updates (app open)

- While the app is in the foreground it polls `GET /api/mobile/changes` every 30 s (`apps/mobile/lib/live-updates.ts`)
  and quietly reloads only the parts whose counter moved; it also reloads everything on open and foreground. The
  counters are the home shown's (`?projectId=`); the reply's `projects` key moves when the client's list of homes does
  (one added or removed, or its dates or stage), and the app reloads that list
- The counters are `projects.project_rev|obra_rev|photos_rev|documents_rev`, bumped by `markChanged()`
  (`packages/core/src/changes.ts`) **after** each write the client can see, naming only what it wrote. Which
  counters each app part reads is declared once there (`READS`: the obra also shows the dates and photos). A new
  core write must call it and get a case in `packages/core/test/changes.test.ts` (a test fails otherwise); budget
  drafts don't, the app only sees the accepted revision. Mobile-only: staff don't need it, so no `/api/v1` route

### Offline (apps/mobile)

- Inicio, Obra (with Fase, Pagos, Hito) and Fotos keep the last successful answer on the phone: the list of homes, and
  per home the obra and the photo list (`lib/offline-cache.ts`: one JSON file per user / part / home in `Paths.cache`,
  which backups leave out; versioned with `OFFLINE_FORMAT`, an older or broken file is ignored and deleted). It is
  opt-in in `useClientData(fetch, { cache: { name, projectId }, onFresh })` (`useProjectData(fetch, name)` for a home's
  part): the copy shows at once, a server answer replaces it and is stored, and a network failure (`network_error` /
  `timeout`) keeps it with `offline` + `updatedAt`, shown by `components/offline-note.tsx` ("Sin conexión · datos del …").
  A key change (another home or user) drops what was shown. The list of homes prunes the files of homes no longer
  theirs; `signOut` (also the forced one on `unauthorized`) wipes everything (`clearOffline`, which also stops a load in
  flight from writing). A photo is cached by expo-image's disk cache (thumbnails seen show offline; one never loaded
  shows a placeholder). No writes offline, no outbox. App-only: no server or database change

### Contact (the app's Contacto)

- Design `doc/mobile-app-design/A-Contact.dc.html` without its "Mensaje" action and site-visit booking (the platform
  has neither). Service `packages/core/src/contact.ts` (`contactService`); app screen `app/(app)/contact.tsx`, pushed
  from Inicio's "Contactar" and a payment hito's "Contactar"; it loads each time it opens, so no change counter
- A project's **site manager** is one of the tenant's staff users (`projects.site_manager_user_id`, `ON DELETE SET
  NULL`), picked by admins/managers on the project's General tab ("Jefe de obra" card, `SiteManagerCard`); shown only
  while that user is active staff of the tenant (deactivated: gone from the app at once). The client sees their name,
  `users.phone` (staff only; set by an admin on Usuarios) and email; call/email open the dialer and the mail app
  (`Linking`), an action without its data isn't drawn. No availability line (no honest source)
- The **office** is the tenant's (`tenants.office_address|office_phone|office_email|office_hours`, free text), set by
  an admin on **Contacto para clientes** (`/dashboard/contacto`, in the rail's settings menu); the app heads it
  "Oficina {tenant name}" and leaves it out when all four are blank. Nothing given at all: an honest empty state
- API: `GET /api/mobile/contact` (`?projectId=`, `MobileContact`), `GET`/`PUT /api/v1/projects/:id/site-manager`
  (`{ userId }`, null for none), `GET`/`PUT /api/v1/tenant/contact`, `phone` on `GET`/`POST /api/v1/users` and
  `PATCH /api/v1/users/:id`. Prod SQL (before the code: every read of those tables names the columns):
  `packages/db/sql/2026-11-15-1410-client-contact.sql`

### Garantía (warranty claims)

- The first thing the client writes. Service `packages/core/src/warranty.ts` (`warrantyService`), types and limits in
  `@repo/core/contract` (`contract/warranty.ts`), bodies in `inputs/warranty.ts`. A handed-over home's client (stage ≥ 8,
  else 409 `not_handed_over`) sends a claim from the app: kind (`WARRANTY_KINDS`, the mockup's chips), room
  (`WARRANTY_ROOMS`), description (≤ 2000), urgent; numbered per home GAR-001 (`warrantyRef`), with an idempotency key.
  Then each photo in its own request (JPEG/PNG/WebP by its bytes, ≤ 4 MB, 4 per claim, with a WebP thumbnail:
  `photo-image.ts`, shared with project photos), only while it is `received`. Caps per home: 5 waiting at once (409
  `too_many_open_claims`), 3 a day (429 `too_many_claims_today`). Status received → in_review → scheduled (needs
  `visit_on`) → resolved, or rejected (needs the answer, its reason), or cancelled by the client while still `received`
  (else 409 `claim_closed`; staff can't change a cancelled one). A client reads only the claims they sent, on a home
  still theirs. Nothing is deleted; every step goes to `warranty_claim_events` (the client sees them without staff names)
- Coverage (LOE art. 17: 1 year finishes, 3 habitability, 10 structure) runs from the hand-over day: H9's
  `acta_signed_on`, else H9's `paid_on`, else the hand-over date the client was told (`clientDates`); `handoverSource`
  says which
- The client is told: staff's change of status, of a scheduled visit's day or a new answer pushes (`notifications.ts`,
  kind `warranty`, the Perfil toggle "messages": the site manager answering; it opens the claim). Every write either
  side makes bumps the home's `project` counter (no counter of its own: claims are rare and part of the home's record),
  and the app's warranty screens reload with the list of homes (`useReloadWithHome` in `apps/mobile/lib/warranty.ts`)
- App: `app/(app)/warranty/` (`index` the form, A-Warranty; `claims` Mis solicitudes; `[id]` one claim, with cancel),
  reached from Inicio's Garantía shortcut and from a push. Photos with `expo-image-picker` (camera or library, JPEG at
  0.6 quality; iOS asked for a compatible JPEG, never HEIC). API `/api/mobile/warranty` (GET coverage + claims, POST
  create, `?projectId=`), `…/warranty/:id` (GET), `…/:id/cancel` (POST), `…/:id/photos` (POST multipart `file`),
  `…/:id/photos/:photoId` (GET, `?size=thumb`)
- Portal: project tab Garantía (`dashboard/projects/[id]/garantia/`: coverage + list, `[claimId]` the claim with its
  photos, the status / visit / answer form (admins, managers) and its history); views in `components/warranty/`;
  actions `app/actions/warranty.ts`. API `/api/v1/projects/:id/warranty` (GET), `…/warranty/:claimId` (GET, PATCH),
  `…/:claimId/photos/:photoId` (GET). No tenant-wide list and no project-list signal yet. Prod SQL:
  `packages/db/sql/2026-11-15-1420-warranty-claims.sql`

### Project documents

- PDFs (≤ 4 MB, `MAX_DOCUMENT_BYTES`) shared with a project's client. Admins/managers upload and delete (soft: see Database) on the project page; all staff can download. Service: `packages/core/src/documents.ts`
- `visible_to_client` decides whether the app shows a document (staff switch it on the Documents tab); budget inputs
  start staff-only. Budget documents (`budget_input`, `budget_pdf`) are grouped first; issued PDFs can't be deleted
- Files live in a **private Vercel Blob store** (`packages/core/src/storage.ts`) and are only ever streamed through our API after an auth check — no public or presigned URLs. Uploads go through our functions, hence the 4 MB cap (Vercel's 4.5 MB body limit)
- The mobile app keeps offline copies (`apps/mobile/lib/document-store.ts`), syncs on app open / foreground / pull-to-refresh, and wipes them on sign-out.
  They live in the app's cache directory (`Paths.cache`), which device backups leave out (iOS iCloud, Android Auto
  Backup); the OS may empty it and the next sync downloads them again. Copies an older build kept in `Paths.document`
  are moved there on first run. Never keep a client's file in `Paths.document`
- Photos are visible to the client by default too; staff hide or show each on Obra › Fotos (`project_photos.visible_to_client`,
  `setPhotoVisibility`, `PATCH /api/v1/projects/:id/photos/:photoId`). Prod SQL: `packages/db/sql/2026-10-client-visibility.sql`
- A photo or document the client can see pushes a notification to the project's client (`packages/core/src/notifications.ts`, via Expo's push service) when uploaded visible or first shown, **once only** (`client_notified_at`: hiding and showing it again pushes nothing; photos one push per 10-minute batch), if their Perfil toggle is on; a failed push never fails the upload. Push needs an EAS project id (`npx eas init`) and a development/store build (not Expo Go); Android sends through
  Firebase project `vitah-es` (`apps/mobile/google-services.json` + its FCM V1 service-account key in EAS credentials),
  iOS needs an APNs key (`eas credentials -p ios`)
- Tests swap storage for an in-memory one: `vi.mock("@repo/core/storage", () => import("@repo/core/testing"))`
- Drizzle Kit for migrations: `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:push`
- Seed script: `pnpm db:seed` creates the tenant, the admin user, project VTH-26-001 (with the Caviedes budget, accepted, its obra half built, subcontractors and orders) and its mobile app client
- Local dev: Docker Compose with PostgreSQL 16 (`docker-compose.yml` at root)
- Vercel: `POSTGRES_URL` injected automatically from linked Vercel Postgres store

### TypeScript

- `declaration: false` in app tsconfigs (required for next-auth type inference)
- `noUncheckedIndexedAccess: true` — always handle possible `undefined` on index access
- `strictNullChecks: true`
- Path alias `@/*` maps to project root (configured in `tsconfig.json`)

### CSS & Styling

- **Tailwind CSS v4** — CSS-first config, no `tailwind.config.js`
  - Shared theme: `@import "@repo/tailwind-config/theme.css"` (brand colors available as `bg-verde-oliva`, `text-blanco-calido`, etc.)
  - PostCSS plugin: `@tailwindcss/postcss` (configured in `postcss.config.mjs`)
  - `@theme inline` block in `globals.css` maps shadcn CSS vars to Tailwind color tokens
- **shadcn/ui** — add components with `pnpm dlx shadcn@latest add <component> --cwd apps/web`
  - Components land in `apps/web/components/ui/`
  - Uses `class-variance-authority`, `clsx`, `tailwind-merge`
  - Utility: `cn()` from `@/lib/utils` for conditional class merging
  - The components are themed to the portal look — restyle them there, not per screen. Variants added:
    `Badge` `good` / `yel` / `warn` / `destructive` / `info` / `outline` (status pills); `Button` `outline` is the
    secondary button, `secondary` the dark-ink one, `ghost-destructive` a quiet delete
  - Portal-specific primitives in the same folder: `Card` / `cardVariants({ size })` (use `cardVariants` on a
    `form` or `section`), and `field.tsx` (`Field`, `FieldDescription`, `FormActions`, `FormMessage`). Translated
    action errors go through `app/dashboard/components/FormError.tsx`
  - The shadcn CLI needs `pnpm` on PATH and may write `import { cn } from "cn"` and add a `cn` npm package —
    fix the import to `@/lib/utils` and drop the dependency
- **Numbers and dates** are written by one module: `@repo/core/format` (`formatMoney`, `formatAmount`,
  `formatQuantity`, `formatPercent`, `formatDate`, `formatDateTime`, `formatDateRange`…; thousands separator always,
  cents always, one date style, `Europe/Madrid`, a missing date is "—"), in the portal through `useFormat()`
  (`apps/web/lib/format.ts`). Never `Intl.*`, `toLocale*String` or next-intl's formatter in a view (ESLint fails). A
  money total says its VAT basis with `useVatLabel()` (`dashboard/components/vat-basis.ts`: "sin IVA" / "IVA incl.")
- **Shared portal behaviour** (`app/dashboard/components/`): `useConfirm` (the confirmation dialog for anything that
  deletes, cancels or cannot be undone; never the browser's `confirm`), `useUrlState` (a view's filters and open
  groups kept in the URL, replaced not pushed; long tables fold by chapter with `FoldRow`), and `place.ts`
  (`placeOf(pathname)`: the page's header and browser title; a new section or project tab gets a row there)
- **No CSS Modules, no hex colours or inline colour styles in components.** Style with Tailwind classes and
  the theme tokens in `globals.css`, so dark mode keeps working. Inline `style` only for computed values
  (a progress width, a grid template)
- **Portal look** ("carril grafito"): grafito sidebar rail beside a warm-grey workspace of white cards (14px radius,
  1px border, soft `shadow-card`, 18px padding); h1/h2 in Barlow Condensed (styled globally in `globals.css`);
  uppercase `eyebrow` labels; `num` (mono, tabular) for money, quantities and %; tables with uppercase muted
  headings and a heavy rule over totals; status shown as soft pills. Light by default, dark when the system is
  (`prefers-color-scheme`); `.dark` forces dark on a subtree (the login page is always grafito)
- **Type scale** (`globals.css`): reading text is `text-sm` (14px: table cells and their `num` figures, fields, labels,
  buttons, paragraphs); `text-meta` (13px) only for secondary text (hints, captions, metadata); `text-xs` (12px) the
  floor (eyebrows, pills, table headings). Never an arbitrary `text-[Npx]` under 14px (`app/type-scale.test.ts` fails)
- **Tokens** (Tailwind names): shadcn's `background`, `foreground`, `card`, `primary` (verde oliva), `muted-foreground`,
  `border`, `destructive` (= `bad`), plus `raise` (inset surfaces, inputs, row hover), `brand-soft`/`brand-ink`,
  status pairs `good`/`good-soft`, `yel`, `warn`, `bad`, `info` (each with `-soft`), `rail`/`rail-foreground`/
  `rail-muted`/`rail-accent`, and `shadow-card`

### File structure patterns

```
apps/web/
  auth.ts                          # Re-exports from @repo/auth
  proxy.ts                         # Route protection (Next 16 "proxy", formerly middleware)
  postcss.config.mjs               # @tailwindcss/postcss plugin
  i18n/request.ts                  # next-intl config
  i18n/client-messages.ts          # Which translations each layout sends to its client components
  messages/{locale}.json           # Translation strings
  lib/utils.ts                     # cn() utility for Tailwind class merging
  components/ui/                   # shadcn/ui components, themed to the portal look
  app/
    page.tsx                       # Login page (Server Component)
    layout.tsx                     # Root layout with NextIntlClientProvider
    globals.css                    # Tailwind imports, theme tokens (light + dark), base typography
    actions/auth.ts                # Server actions for login
    actions/users.ts               # Server actions for user management (admin)
    components/LoginForm.tsx       # Client Component with useActionState
    dashboard/page.tsx             # Redirects to /dashboard/projects
    dashboard/projects/            # Project list + detail (header, client app access, documents)
    dashboard/projects/new/        # New-project wizard: steps/index.ts is the step registry
    dashboard/components/wizard/   # Generic multi-step flow: useWizard (logic), Wizard/ReviewStep (views)
    dashboard/clients/             # Mobile app clients (admin): ClientsScreen container + pure views in components/
    dashboard/users/               # User management page (admin)
    api/auth/[...nextauth]/route.ts
```

### Testing

- Vitest in `packages/core`, `packages/auth`, `apps/web`; jest-expo in `apps/mobile` (`__tests__/`)
- DB tests run against a real, disposable Postgres database per package (`vitah_<pkg>_test_<checkout hash>`, so worktrees sharing one Postgres never collide; recreated each run via `testDatabase()` from `@repo/db/vitest`). Override the server with `TEST_POSTGRES_URL`
- Seed data with `createTestTenant` / `createTestUser` / `createTestProject` from `@repo/db/testing`
- Web server actions: mock the session with `vi.mock("<path>/auth", ...)` and `signInAs()` from `apps/web/test/session.ts`

## Local Development Setup

Prerequisites: Docker Desktop

```bash
pnpm install                         # Install dependencies
pnpm db:setup                        # Start Postgres + push schema + seed data
pnpm exec turbo dev --filter=web     # Start web app on localhost:3000
```

Login with `admin@vitah.es` / `vitah2026`. The mobile app logs in as `cliente@vitah.es` / `vitah2026` (client of project VTH-26-001).

To reset the database: `docker compose down -v && pnpm db:setup`

## Environment Variables

Each app needs `.env.local` (not committed):
```
NEXTAUTH_SECRET=<generated-secret>
POSTGRES_URL=postgres://vitah:vitah_dev@localhost:4432/vitah   # local Docker default
BLOB_READ_WRITE_TOKEN=<token of a private Blob store>           # apps/web only, for documents
ANTHROPIC_API_KEY=<key>                                         # apps/web only, for the AI budget draft
```

On Vercel, `POSTGRES_URL` is injected automatically from the linked Vercel Postgres store, and Blob
credentials from the connected private Blob store. `ANTHROPIC_API_KEY` is set by hand; Vercel Workflow runs the
budget AI (no extra config beyond `withWorkflow` in `next.config.js`).

## Brand Reference

Design docs in `/doc/`:
- `ViTAH_Libro_de_Estilo_v1.pdf` — full brand book (colors, typography, logo usage, voice & tone)
- `Diseño Showroom ViTAH- Experiencia de Vivienda Sal....pdf` — showroom experience design
- `mobile-app-design/` — approved mobile app design (Concept A), spec + per-screen mockups
