# ViTAH — Monorepo

PropTech platform for healthy, efficient, intelligent homes. Tagline: "Tecnología para vivir mejor".

## Architecture

Turborepo monorepo with pnpm@9.0.0 workspaces.

### Apps

| App | Package name | Port | Purpose |
|-----|-------------|------|---------|
| `apps/web` | `web` | 3000 | Admin portal — login, dashboard, client-facing |
| `apps/app` | `docs` | 3001 | Internal app |

### Shared Packages

| Package | Name | Purpose |
|---------|------|---------|
| `packages/auth` | `@repo/auth` | NextAuth.js v5 config (Credentials provider, JWT sessions) |
| `packages/db` | `@repo/db` | Drizzle ORM schema, database client, seed script (postgres.js driver), test helpers (`./testing`, `./vitest`) |
| `packages/core` | `@repo/core` | Shared business logic (project client access, mobile project data). `./contract` holds DB-free types/constants safe for mobile and browser code |
| `packages/shared` | `@repo/ui` | React UI components (exports `./src/*.tsx`) |
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
pnpm db:seed                         # Seed initial tenant + admin user
pnpm db:studio                       # Open Drizzle Studio (DB browser)
```

## Tech Stack

- **Next.js 16.2.0** (App Router, Turbopack)
- **React 19.2.0** / TypeScript 5.9.2
- **NextAuth.js 5.0.0-beta.31** — Credentials provider, JWT sessions, Drizzle adapter
- **Drizzle ORM 0.35** + **postgres.js** — database layer with multi-tenant schema (works with any PostgreSQL)
- **next-intl 4.12.0** — i18n (Spanish default, English)
- **Tailwind CSS 4.3.0** + **shadcn/ui** — utility-first CSS with component library
- **CSS Modules** — used alongside Tailwind for complex layout styles
- **Geist fonts** — loaded locally (woff), used as Calibri substitute

## Key Conventions

### API-first: every backend feature must be shared

When adding any API route, server action, or backend logic:
- Put shared auth/business logic in `packages/` (e.g., `@repo/auth`)
- Both `apps/web` and `apps/app` must be able to consume it
- Each app has its own `auth.ts` that re-exports from `@repo/auth`
- Each app has its own `app/api/auth/[...nextauth]/route.ts`

### Mobile-first responsive design (apps/web)

`apps/web` must always be mobile-friendly:
- Design mobile layout first, enhance for desktop with `min-width` media queries
- Test at 320px, 480px, 768px, 1024px breakpoints
- Touch targets minimum 44px
- No horizontal scroll at any viewport width
- Use `clamp()` for fluid typography where appropriate

### ViTAH Brand Identity

**Color palette** (CSS custom properties in `globals.css`):
- `--grafito: #1e1e1e` — primary dark background
- `--verde-oliva: #6b7a4a` — accent (buttons, interactive elements)
- `--verde-oliva-hover: #7d8e58` — hover state
- `--blanco-calido: #e8e7e2` — text on dark, light surfaces
- `--verde-oscuro: #37505a` — secondary accent
- `--error: #c75050` — error states

**Design style:** "Minimalista de Lujo" — generous whitespace, no decorative effects, no shadows on logo, subtle transitions.

**Logo:** Wordmark "ViTAH" (note casing: V-i-T-A-H) with wide letter-spacing. Always paired with descriptor "TECNOLOGÍA PARA VIVIR MEJOR" in uppercase.

**Approved logo backgrounds:** Grafito, Blanco Cálido, Verde Oscuro only.

**Do NOT use:** orange #D4500A, navy #1A2B4A (old Framer SF brand colors).

### i18n

- Default locale: `es` (Spanish)
- Supported: `es`, `en`
- Translation files: `apps/web/messages/{locale}.json`
- Config: `apps/web/i18n/request.ts`
- All user-facing text must use `useTranslations()` — never hardcode strings
- Add keys to both `es.json` and `en.json` when adding new text

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
- Login page is `/`, authenticated users redirect to `/dashboard`
- Middleware protects all routes except `/`, `/api/auth/*`, `/api/mobile/*`, and static assets
- User roles: `admin`, `manager`, `viewer` (staff, portal only) and `client` (homeowner, mobile app only) — Postgres enum. Use `isStaffUser` / `isClientUser` / `STAFF_ROLES` from `@repo/db`
- Clients are created from the project page ("Client app access" card), one project per client; client emails are unique across tenants
- Mobile API: `POST /api/mobile/auth` (clients only, returns a 30d JWT) and `GET /api/mobile/project` (`Authorization: Bearer`). Each request re-checks the client is still active
- Admin-only server actions guarded by `requireAdmin()` check

### Database

- **Driver:** `postgres` (postgres.js) — works with any PostgreSQL (local Docker, Vercel Postgres, AWS RDS, etc.)
- Schema in `packages/db/src/schema.ts` — tables: `tenants`, `users`, `accounts`, `sessions`, `verification_tokens`, `projects` (+ milestones, quality checks, tasks, material orders, invoices, documents, activity log). `projects.client_user_id` links a project to its mobile app client
- Drizzle Kit for migrations: `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:push`
- Seed script: `pnpm db:seed` creates initial tenant + admin user
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
- **CSS Modules** — still used for complex layout styles (`.module.css`)
- Global brand tokens in `globals.css` via CSS custom properties
- Dark theme by default (`color-scheme: dark`)
- Semantic variable names: `--background`, `--foreground`, `--muted`, `--input-bg`, `--input-border`

### File structure patterns

```
apps/web/
  auth.ts                          # Re-exports from @repo/auth
  middleware.ts                    # Route protection
  postcss.config.mjs               # @tailwindcss/postcss plugin
  i18n/request.ts                  # next-intl config
  messages/{locale}.json           # Translation strings
  lib/utils.ts                     # cn() utility for Tailwind class merging
  components/ui/                   # shadcn/ui components
  app/
    page.tsx                       # Login page (Server Component)
    layout.tsx                     # Root layout with NextIntlClientProvider
    globals.css                    # Tailwind imports, shadcn theme, brand tokens
    actions/auth.ts                # Server actions for login
    actions/users.ts               # Server actions for user management (admin)
    components/LoginForm.tsx       # Client Component with useActionState
    dashboard/page.tsx             # Authenticated placeholder
    dashboard/users/               # User management page (admin)
    api/auth/[...nextauth]/route.ts
```

### Testing

- Vitest in `packages/core`, `packages/auth`, `apps/web`; jest-expo in `apps/mobile` (`__tests__/`)
- DB tests run against a real, disposable Postgres database per package (`vitah_<pkg>_test`, recreated each run via `testDatabase()` from `@repo/db/vitest`). Override the server with `TEST_POSTGRES_URL`
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
```

On Vercel, `POSTGRES_URL` is injected automatically from the linked Vercel Postgres store.

## Brand Reference

Design docs in `/doc/`:
- `ViTAH_Libro_de_Estilo_v1.pdf` — full brand book (colors, typography, logo usage, voice & tone)
- `Diseño Showroom ViTAH- Experiencia de Vivienda Sal....pdf` — showroom experience design
