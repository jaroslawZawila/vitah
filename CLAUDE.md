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
| `packages/core` | `@repo/core` | Business logic / service layer (tenant-scoped, takes `ctx`) — the single API. `./contract` holds DB-free types/constants safe for mobile and browser code |
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
   any of them fail. Never bypass it or skip failing tests.

## Tech Stack

- **Next.js 16.2.0** (App Router, Turbopack)
- **React 19.2.3** / TypeScript 5.9.2 — one React across the monorepo, pinned by root `pnpm.overrides`
- **Expo SDK 57** / React Native 0.86 (New Architecture only), Expo Router 57, jest-expo. Icons from
  `@react-native-vector-icons/feather` (not the deprecated `@expo/vector-icons`). `apps/mobile` keeps
  TypeScript 5.9.2 via `expo.install.exclude`; upgrade with `npx expo install expo@^<sdk> && npx expo install --fix`
- **NextAuth.js 5.0.0-beta.31** — Credentials provider, JWT sessions, Drizzle adapter
- **Drizzle ORM 0.35** + **postgres.js** — database layer with multi-tenant schema (works with any PostgreSQL)
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
- `proxy.ts` protects all routes except `/`, `/api/auth/*`, `/api/mobile/*`, `/api/v1/*` (these authenticate per request), and static assets
- User roles: `admin`, `manager`, `viewer` (staff, portal only) and `client` (homeowner, mobile app only) — Postgres enum. Use `isStaffUser` / `isClientUser` / `STAFF_ROLES` from `@repo/db`. `Ctx` is staff-only: client tokens are rejected by `/api/v1`
- Clients are created on the **Clients** tab (`/dashboard/clients`, admin only): first name, surnames, date of birth, address, phone, email and app password. Personal details live in `client_profiles`; login data stays on `users`. Client emails are unique across tenants. A project has at most one client, picked from the existing clients on the project page ("Client app access" card); removing them only detaches, the account stays
- Mobile client API: `POST /api/mobile/auth` (clients only, returns a 30d JWT), `GET /api/mobile/project`, `GET /api/mobile/documents` and `GET /api/mobile/documents/:id` (the PDF), `GET /api/mobile/photos` and `GET /api/mobile/photos/:id` (`?size=thumb`), `POST /api/mobile/password`, `GET`/`PUT /api/mobile/settings` (notification toggles), `POST`/`DELETE /api/mobile/push-token` (the phone's Expo push token + app language), `GET /api/mobile/obra` (the Obra tab: stage, progress, phases, payment hitos), `GET /api/mobile/obra/hitos/:id/:kind` (a hito's signed `acta` or `invoice` PDF) and `GET /api/mobile/changes` (change counters, see "Live updates") — all `Authorization: Bearer`, via `withMobileClient` in `apps/web/lib/api.ts`. Each request re-checks the client is still active
- Admin-only server actions guarded by `requireAdmin()` check

### Database

- **Driver:** `postgres` (postgres.js) — works with any PostgreSQL (local Docker, Vercel Postgres, AWS RDS, etc.)
- Schema in `packages/db/src/schema.ts` — tables: `tenants`, `users`, `client_profiles`, `client_settings`, `push_tokens`, `accounts`, `sessions`, `verification_tokens`, `projects`, `project_documents`, `project_photos`, the construction control's `obra_chapter_progress`, `obra_progress_events`,
  `obra_invoice_requests`, `obra_issues`, `obra_issue_files`, and the obra's `budget_revisions`, `budget_chapters`, `budget_lines`, `obra_hitos`, `obra_hito_chapters`, `obra_hito_checks`, `obra_hito_photos`, plus `budget_generations` (AI runs) and `ai_usage` (one row per Claude call, with its cost), and the
  Subcontratas tables `subcontractors`, `subcontractor_workers`, `subcontractor_documents`, `subcontractor_document_versions`,
  `subcontractor_assignments`, `subcontractor_audit`, Compras' `purchase_orders`, `purchase_order_lines`,
  `purchase_order_events`, and Planning's `planning_versions`, `planning_items`. A project is deliberately minimal — exactly what the mobile app shows: `ref`, `address`, `start_date`, `completion_date`, plus `client_user_id` linking it to its mobile app client
- Prod migrations are additive SQL files in `packages/db/sql/`, applied by hand (no plain `db:push` on prod)

### Obra (construction process)

- The process is `features/construction_process/PROCESS.md`: 8 stages (`projects.obra_stage`, set by staff), a
  budget in the FRAMER model, and payment hitos H0–H9. Designs: `doc/mobile-app-design/A-Progress|A-Fase|A-Obra-Pagos|A-Hito`
  and `doc/platform-design/P-*`
- Budget (`packages/core/src/budget.ts`): revisions → chapters → lines (partidas), money in cents, quantities in
  thousandths. Staff then record each line's executed %; a change is a new revision (copied, compared with the
  previous). Only the accepted revision drives prices and progress. The budget itself is under "Budget" below
- Hitos (`hitos.ts`): every project starts with the standard plan (`obra-template.ts`); staff set each hito's % and the
  chapter codes it closes. The acta is signed on paper; staff upload it and the invoice (PDFs), then record the payment
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
  (`closes_line`: nothing more to order for it). Every change goes to `purchase_order_events`; one PDF per order
- A line's contracted amount = its orders from ordered/contracted on (pending and cancelled don't count); its
  deviation (cost − contracted) counts only once it is closed, so an open line never shows as a saving. The Obra tab's
  Costes/Resumen read it; a material order past its expected date and not delivered is a late delivery (warning only)
- Suppliers are the Subcontratas companies; a material supplier is `subcontractors.supplies_only` (no CAE documents,
  workers or obras: always apta; it can't take a subcontract)
- Portal: project tab Compras (`dashboard/projects/[id]/compras/`: list, `nuevo`, `[orderId]`, `[orderId]/editar`) and the
  rail's company-wide Compras (`dashboard/compras/`, every order of the tenant for Administration). API: `/api/v1/purchases`
  (`?projectId`, `?subcontractorId`), `/api/v1/purchases/:orderId` (GET, PATCH), `…/status` (POST), `…/file`;
  `/api/v1/projects/:id/purchases` (GET, POST) and `…/purchases/form`. `pnpm db:seed` gives VTH-26-001 its orders
  (`seed/purchasing.ts`). Prod SQL: `packages/db/sql/2026-10-purchasing.sql`

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
- Lines are priced at **cost**; gastos asociados and beneficio industrial (`overhead_bp` / `profit_bp`, default 13 % +
  6 %, §18) go into each unit price, and the PEC is the sum of the priced lines (`priceLines` in `obra-calc.ts`,
  `linesPriceSql` in SQL). Only the portal's summary shows the margins apart; the PDFs (`forClient`), obra, hitos and
  app see the priced lines
- Model `framer20`: always the 20 fixed chapters 01–20 (`budget-template.ts`); chapter 20 is one computed line,
  `contingency_bp` × chapters 01–19, kept in sync by `syncDraft` (`budget-draft.ts`) inside every draft write.
  Options live below as `budget_chapters` with `kind = 'option'` (codes OP1, OP2…, lines numbered OP.01… across
  all options, renumbered automatically); they may subtract (deductions, alternatives). Lines can come from the fixed
  FRAMER 2026 price base (`price-base-data.ts`, unit costs, searched with `searchPriceBase`) or be "estimated"
- Status: draft → issued (frozen; both PDFs stored as project documents) → accepted or rejected; an older revision is
  superseded when a later one is accepted. One draft at a time; from Rev.1 issuing needs a `changeReason`.
  Accepting records the options the client chose: contract price = PEC + chosen options (at price), and that is what the obra,
  hitos H0–H9 and the app use (`inContract` in `obra-data.ts`). Accepting a draft directly still works (v1)
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
- Portal: Budget tab pages under `dashboard/projects/[id]/budget/` (summary, lines, options, texts, conditions,
  pdf; `?revision=` shows an older one, picked from the menu on the revision pill); `BudgetScreen` / `BudgetStartScreen` are the containers, views in
  `components/budget/`. Web-only: the app only sees the general PDF (Documentos) and the contract via the obra

### Subcontratas (CAE)

- Companies (and self-employed) working on the obras, their workers and the CAE documents asked of them (RD 171/2004,
  Ley 32/2006). Web-only and staff-only: the client never sees it, so no `/api/mobile` route and no `markChanged`
- Pure rules in `packages/core/src/subcontractor-rules.ts` (re-exported by `@repo/core/contract`, also run in the
  browser): the document template `SUBCONTRACTOR_REQUIREMENTS` (stable ids, validity), expiry (`docState`; alert 30
  days before, 7 for monthly documents), company status (`companyStatus`: apta / pendiente / bloqueada — computed, never
  stored), worker access (`workerAccess`: the six rules, with reasons), CIF/NIF/NIE check digits, masking, REA region
  from the postal code. Services: `subcontractors.ts` (companies, documents, obra assignments, overview, CAE dossier
  ZIP) and `subcontractor-workers.ts`; both load the tenant's whole network at once (`subcontractor-network.ts`)
- Documents are versioned: an upload adds an immutable version (private Blob store); validate / reject (with reason)
  act on the current one. Every write goes to `subcontractor_audit` (the ficha's Historial)
- Admins and managers (contractor, jefe de obra) write; viewers read with masked CIF/DNI. No subcontractor portal login yet
- A material supplier (`supplies_only`, for Compras) has no CAE: no documents, workers or obra assignments
  (`supplies_only` error), never in the attention list or the status counts
- Portal: rail group "Red" › Subcontratas (`dashboard/subcontratas/`: `empresas`, `empresas/nueva` wizard,
  `empresas/[id]` ficha + `editar`, `trabajadores`, `trabajadores/nuevo`, `trabajadores/[id]`); API `/api/v1/subcontractors/**`.
  `pnpm db:seed` adds eight fictional companies on VTH-26-001. Prod SQL: `packages/db/sql/2026-10-subcontractors.sql`

### Live updates (app open)

- While the app is in the foreground it polls `GET /api/mobile/changes` every 30 s (`apps/mobile/lib/live-updates.ts`)
  and quietly reloads only the parts whose counter moved; it also reloads everything on open and foreground
- The counters are `projects.project_rev|obra_rev|photos_rev|documents_rev`, bumped by `markChanged()`
  (`packages/core/src/changes.ts`) **after** each write the client can see, naming only what it wrote. Which
  counters each app part reads is declared once there (`READS`: the obra also shows the dates and photos). A new
  core write must call it and get a case in `packages/core/test/changes.test.ts` (a test fails otherwise); budget
  drafts don't, the app only sees the accepted revision. Mobile-only: staff don't need it, so no `/api/v1` route

### Project documents

- PDFs (≤ 4 MB, `MAX_DOCUMENT_BYTES`) shared with a project's client. Admins/managers upload and delete on the project page; all staff can download. Service: `packages/core/src/documents.ts`
- `visible_to_client` decides whether the app shows a document (staff switch it on the Documents tab); budget inputs
  start staff-only. Budget documents (`budget_input`, `budget_pdf`) are grouped first; issued PDFs can't be deleted
- Files live in a **private Vercel Blob store** (`packages/core/src/storage.ts`) and are only ever streamed through our API after an auth check — no public or presigned URLs. Uploads go through our functions, hence the 4 MB cap (Vercel's 4.5 MB body limit)
- The mobile app keeps offline copies (`apps/mobile/lib/document-store.ts`), syncs on app open / foreground / pull-to-refresh, and wipes them on sign-out
- Uploading a photo or document pushes a notification to the project's client (`packages/core/src/notifications.ts`, via Expo's push service), if their Perfil toggle is on; a failed push never fails the upload. Push needs an EAS project id (`npx eas init`) and, on Android, a development/store build
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
- **No CSS Modules, no hex colours or inline colour styles in components.** Style with Tailwind classes and
  the theme tokens in `globals.css`, so dark mode keeps working. Inline `style` only for computed values
  (a progress width, a grid template)
- **Portal look** ("carril grafito"): grafito sidebar rail beside a warm-grey workspace of white cards (14px radius,
  1px border, soft `shadow-card`, 18px padding); h1/h2 in Barlow Condensed (styled globally in `globals.css`);
  uppercase `eyebrow` labels; `num` (mono, tabular) for money, quantities and %; tables with uppercase muted
  headings and a heavy rule over totals; status shown as soft pills. Light by default, dark when the system is
  (`prefers-color-scheme`); `.dark` forces dark on a subtree (the login page is always grafito)
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
