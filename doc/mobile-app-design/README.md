# Mobile app design — Concept A "Grafito" (approved)

This is the **approved design for the client mobile app** (`apps/mobile`). Every mobile screen or
feature must follow it. When a feature is not drawn here, extend the same language rather than
inventing a new one.

- **Live canvas (clickable prototype):** https://claude.ai/artifact/DjsuyQ9747VaRm7toZmpBj
  (top row "Concepto A — Grafito"; the bottom row, Concept B, was **rejected** — ignore it)
- **Source of truth in the repo:** the `A-*.dc.html` files in this folder — one per screen, plain
  HTML with inline styles, so exact sizes/colours can be read straight from them.

The copy in the mockups is Spanish sample data (client "Elena", site manager "Javier Ruiz",
"Nordic" collection, file names, counts). Only the project ref, address and dates come from the
seed. In the app every string goes through i18n (`es` + `en`), and data comes from the API.

## Screens

| File | Screen | Feature | Reached from |
|------|--------|---------|--------------|
| `A-Login.dc.html` | Acceso | Sign in (client), ES/EN switch, forgot password | App start |
| `A-Home.dc.html` | Inicio | Project details + progress summary, latest update, shortcuts | Tab **Inicio** |
| `A-Progress.dc.html` | Avance de obra | Overall %, week, status, 8-phase vertical timeline; current phase expands to sub-tasks | Tab **Obra** |
| `A-Gallery.dc.html` | Fotografías | Site photos grouped by week/phase, filter chips | Tab **Fotos** |
| `A-Documents.dc.html` | Documentos | Search, category chips, recent + project docs, download, "NUEVO" badge, locked docs | Tab **Documentos** |
| `A-Settings.dc.html` | Ajustes / Perfil | Profile, language (ES/EN), change password, Face ID, notification toggles, help, logout | Tab **Perfil** |
| `A-Password.dc.html` | Cambiar contraseña | Current / new / repeat, strength meter | Settings |
| `A-Warranty.dc.html` | Solicitud de garantía | LOE coverage (1/3/10 años), type chips, room, description, photos, urgent flag, "Mis solicitudes" | Home shortcut, Contact |
| `A-Contact.dc.html` | Contacto | Site manager card (call / message / email), book a site visit, office info | Home shortcut |

Navigation: bottom tab bar with 5 tabs (Inicio · Obra · Fotos · Documentos · Perfil). Warranty,
Contact and Password are pushed screens with a back chevron and no tab bar. Primary actions in
pushed screens sit in a fixed bottom bar.

## Visual language

Dark only ("Minimalista de lujo"): generous spacing, thin type, hairline borders, no shadows,
no gradients, no emoji. Icons are 1.4–1.5 px stroke line icons (22 px in the tab bar/headers).

### Colours

Brand colours come from `@repo/brand-tokens`. The design also uses these UI shades, which are
**not yet in the tokens** — add them to `packages/brand-tokens` when implementing:

| Role | Hex | Brand token |
|------|-----|-------------|
| Screen background | `#1e1e1e` | `grafito` |
| Primary text | `#e8e7e2` | `blancoCalido` |
| Secondary text / labels | `#9a9a94` | `muted` |
| Accent text, icons, progress fill, "done" | `#8a9b62` | `verdeOlivaLight` |
| Primary button fill, completed-phase dots (with light text) | `#4a5e2c` | `verdeOlivaDark` |
| Selected outline / switch on | `#6b7a4a` | `verdeOliva` |
| Avatar | `#37505a` | `verdeOscuro` |
| Card / input surface | `#262624` | — *new* |
| Card / input border | `#34342f` | — *new* |
| Row divider, tab bar top border | `#2e2e2b` | — *new* |
| Chip border, empty progress track | `#3c3c37` | — *new* |
| Tab bar background, bottom action bar | `#181817` | — *new* |
| Inactive tab label/icon | `#8a8a84` | — *new* |
| Destructive text ("Cerrar sesión") | `#d98080` | — *new* (light `error` for contrast on dark) |

Use `verdeOlivaDark` (not `verdeOliva`) behind light text: `#e8e7e2` on `#6b7a4a` fails
WCAG contrast at small sizes.

### Typography

Font: **Geist** (the portal's font). Weights 200–500 only; large numbers are ultra-light.
This matches the existing scale in `apps/mobile/constants/theme.ts`:

| Use | Size / weight | Notes |
|-----|---------------|-------|
| Hero number (progress %) | 72 / 200 (ring: 40 / 200) | `%` at ~40 % size in `muted` |
| Screen title | 30 / 300 | `type.display` |
| Section / profile title | 22 / 300 | `type.title` |
| Body, list rows | 15–17 / 400 | `type.body` / `type.subhead` |
| Meta text | 13 / 400, `muted` | |
| Label | 11 / 500, uppercase, letter-spacing ≈ 0.22–0.24 em, `muted` | `type.label` |
| Wordmark "ViTAH" | 16 / 400, letter-spacing 0.4 em (login: 44 / 300) | always with "TECNOLOGÍA PARA VIVIR MEJOR" on the login screen |

### Layout and components

- 390 pt wide reference, screen padding 24, top inset ~56, section gap 22–28.
- Radii: cards 16, tiles/inputs/buttons 8–12, chips and pills fully rounded.
- **Card:** `#262624` fill, 1 px `#34342f` border, radius 16, padding 22–24.
- **Primary button:** height 54, `#4a5e2c` fill, radius 8, label 13/500 uppercase, letter-spacing 0.22 em.
- **Secondary button:** transparent with a 1 px `#e8e7e2` border, same type.
- **Input:** height 52, `#262624` fill, `#34342f` border (focused/valid: `#6b7a4a`), 16 px text, uppercase label above.
- **Chip:** height 40–44, fully rounded; off = transparent with `#3c3c37` border, on = `#e8e7e2` fill with dark text (filters) or `#4a5e2c` fill (form choice).
- **List row:** min height 52–68, bottom divider `#2e2e2b`, trailing chevron or download icon in `muted`.
- **Segmented progress:** one segment per phase (8), 4 px high, gap 4; done = `#8a9b62`, empty = `#3c3c37`.
- **Timeline:** 24 px markers — done = filled `#4a5e2c` with a check, current = `#8a9b62` ring with a dot and an expanded card, upcoming = `#4a4a45` ring with muted text.
- **Switch:** 52×32, on `#6b7a4a` with a light knob, off `#3c3c37` with a `muted` knob.
- **Tab bar:** height 84 including the bottom inset, `#181817`, 5 equal items, icon above a 10 pt label; active = `#e8e7e2`, inactive = `#8a8a84`.
- Touch targets are at least 44×44.

## Data the design needs (beyond today's `projects` table)

The current project model is only `ref`, `address`, `start_date`, `completion_date`. The design also
needs the following. Add each one to `packages/core` + `/api/v1` (backwards compatible) as the
feature is built:

- Collection name; overall progress %; status ("En plazo"); week N of M (derivable from the dates).
- Phases (8, ordered) with status, dates, % and sub-tasks.
- Photo updates: date, week, phase, caption, author, photos.
- Documents: category, type, size, date, "new" flag, locked-until-handover flag, download URL.
- Warranty claims: type, room, description, photos, urgent flag, status list ("Mis solicitudes").
- Assigned site manager (name, phone, email, availability), office info, visit slots and requests.
- Client profile (name, email), password change, notification preferences, language preference.
