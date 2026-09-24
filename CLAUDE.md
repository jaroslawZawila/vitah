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
| `packages/core` | `@repo/core` | Business logic / service layer (tenant-scoped, takes `ctx`) — the single API |
| `packages/auth` | `@repo/auth` | NextAuth.js v5 config, mobile JWT (`./mobile`), request context (`./context`) |
| `packages/db` | `@repo/db` | Drizzle ORM schema, database client, seed script (postgres.js driver) |
| `packages/tailwind-config` | `@repo/tailwind-config` | Shared Tailwind v4 theme with ViTAH brand tokens |
| `packages/eslint-config` | `@repo/eslint-config` | ESLint configs (`./base`, `./next-js`, `./react-internal`) |
| `packages/typescript-config` | `@repo/typescript-config` | Shared tsconfig (`base.json`, `nextjs.json`, `react-library.json`) |

## Commands

```bash
pnpm exec turbo dev                  # Run all apps
pnpm exec turbo dev --filter=web     # Run web only (port 3000)
pnpm exec turbo build                # Build all
pnpm exec turbo build --filter=web   # Build web only
pnpm exec turbo lint                 # Lint all
pnpm exec turbo check-types          # Type check all
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
route. Keep `/api/v1` backwards compatible — installed mobile builds lag behind.

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
- `proxy.ts` protects all routes except `/`, `/api/auth/*`, `/api/mobile/*`, `/api/v1/*` (these authenticate per request), and static assets
- User roles: `admin`, `manager`, `viewer` (Postgres enum)
- Admin-only server actions guarded by `requireAdmin()` check

### Database

- **Driver:** `postgres` (postgres.js) — works with any PostgreSQL (local Docker, Vercel Postgres, AWS RDS, etc.)
- Schema in `packages/db/src/schema.ts` — tables: `tenants`, `users`, `accounts`, `sessions`, `verification_tokens`
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
  proxy.ts                         # Route protection (Next 16 "proxy", formerly middleware)
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

## Local Development Setup

Prerequisites: Docker Desktop

```bash
pnpm install                         # Install dependencies
pnpm db:setup                        # Start Postgres + push schema + seed data
pnpm exec turbo dev --filter=web     # Start web app on localhost:3000
```

Login with `admin@vitah.es` / `vitah2026`.

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
