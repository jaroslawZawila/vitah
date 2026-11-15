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
| `A-Progress.dc.html` | Avance de obra | **One screen, no scrolling:** overall %, week, status, delivery date, next payment, and the 9 phases (pre-construction + hitos H2–H9) with done / current % / pending | Tab **Obra** |
| `A-Fase.dc.html` | Fase de obra | One phase: %, the budget chapters in it with their %, latest photos, what is left to close it, the payment it triggers | Obra › a phase |
| `A-Obra-Pagos.dc.html` | Pagos | Paid so far, next payment, H0–H9 timeline (paid · to pay · in progress · pending) | Obra › "Próximo pago", Fase › payment |
| `A-Hito.dc.html` | Hito de pago | One hito: amount + VAT, due date, scope, chapters, acta photos, signed acta and invoice (read-only) | Pagos |
| `A-Gallery.dc.html` | Fotografías | Site photos grouped by week/phase, filter chips | Tab **Fotos** |
| `A-Documents.dc.html` | Documentos | Search, category chips, recent + project docs, download, "NUEVO" badge, locked docs | Tab **Documentos** |
| `A-Settings.dc.html` | Ajustes / Perfil | Profile, language (ES/EN), change password, Face ID, notification toggles, help, logout | Tab **Perfil** |
| `A-Password.dc.html` | Cambiar contraseña | Current / new / repeat, strength meter | Settings |
| `A-Warranty.dc.html` | Solicitud de garantía | LOE coverage (1/3/10 años), type chips, room, description, photos, urgent flag, "Mis solicitudes" | Home shortcut, Contact |
| `A-Contact.dc.html` | Contacto | Site manager card (call / message / email), book a site visit, office info | Home shortcut, Hito "Contactar" |

**Contacto as built (2026-11-15):** the site manager card has **Llamar** and **Correo** only (an action whose data
staff left blank is not drawn), with no availability line ("Disponible · responde en ~2 h" has no source). The
**Mensaje** action and **Visita tu obra** (slots, "Solicitar visita") are left out: the platform has no messaging or
site visits yet. The office rows are address, phone (tap to call), email (tap to write) and hours, under "OFICINA
{company}"; its last row, "Abrir una solicitud de garantía", opens the Garantía screen. With nothing entered
by the builder, the screen says so in one line under the title.

### Garantía as built (2026-11-15)

`app/(app)/warranty/` follows `A-Warranty.dc.html` with these differences: the room is a row of chips like the type
(the app has no dropdown), the coverage tiles show each period's end once the home is handed over, and before hand-over
the screen only explains that the guarantee starts then (no form). Not drawn, in the same language: **Mis solicitudes**
(rows: GAR-001 · kind, status · day · urgent, the builder's last answer) and **one claim** (status pill, visit day and
answer in a card, description, photos, history "Tú / ViTAH", "Cancelar solicitud" in the bottom bar while nobody has
started on it).

### Several homes (approved 2026-11-04)

A client may own more than one home (project). Canvas: https://claude.ai/artifact/Wg1prD6ZXwN2Vzj6MLzMZs.

| File | Screen | What changes |
|------|--------|--------------|
| `A-Home-Viviendas.dc.html` | Inicio | A "2 VIVIENDAS ⌄" pill on the project card; "Tu otra vivienda" rows (ref, street, status) below the shortcuts — tapping one shows it |
| `A-Viviendas.dc.html` | Mis viviendas (sheet) | Every home: ref, street, status ("En obra · entrega …", "Entregada · jun 2025", "En preparación · inicio …"), % and bar while under construction; the one shown has a green ring and outline |
| `A-Progress-Viviendas.dc.html` | Obra | The eyebrow "REF · STREET" turns verde oliva with a ⌄ and opens the sheet |
| `A-Documents-Viviendas.dc.html` | Documentos / Fotos | The eyebrow "REF ⌄ · 24 DOCUMENTOS" (Fotos: "· 86 FOTOS") |
| `A-Settings-Viviendas.dc.html` | Perfil | A "MIS VIVIENDAS" list (the one shown says "VIENDO"); notifications say "TODAS TUS VIVIENDAS" |

Rules: with **one** home nothing of this shows — the app is exactly as above. With two or more, the app
opens on the home the client last chose on this phone, else the newest one not handed over (the newest
of all when every one is). One home is shown across Inicio, Obra, Fotos and Documentos; pushed screens
(Fase, Pagos, Hito) belong to it and have no switch. A notification names its home (its ref after the
title) and opens the app on it. Each home's documents are kept offline.

### Cambio para aprobar (2026-11-15, no mockup)

When staff ask the client to approve a priced change to the contract (a budget revision from Rev.1 on), Inicio
shows a card right below the project card, and nothing when there is none. It extends the language of
`A-Hito` and `A-Obra-Pagos`:

- **Card (Inicio):** the standard card with a `verdeOliva` border (an action waiting), a 10 pt label
  "CAMBIO PARA APROBAR · REV.2" in `verdeOlivaLight`, the reason for the change (16 pt), the difference in muted
  meta ("+500,00 € sobre tu contrato, sin IVA"), the link "Revisar y responder" and a trailing chevron. A push
  ("Cambio para aprobar") opens the screen directly.
- **Screen `aprobacion` (pushed, back "Inicio", no tab bar):** label "CAMBIO EN TU CONTRATO · REV.2", title
  "¿Apruebas este cambio?", "MOTIVO DEL CAMBIO", the team's message in a card, then an amounts card like the Hito's:
  "Contrato actual", "Con este cambio", a rule, "DIFERENCIA" in 26/300, and a meta line with the difference with VAT.
  Then "QUÉ CAMBIA" (CAM-004 rows), "OPCIONES INCLUIDAS" and the budget's PDF row (file icon, download icon) opened
  like Documentos. A muted note says the answer is recorded and the team registers the acceptance.
- **Fixed bottom bar:** "Rechazar" (secondary) and "Aprobar" (primary). Either swaps the bar to "Cancelar" + "Confirmar"
  / "Enviar" and shows one field above the note: "TU CONTRASEÑA" to approve, "MOTIVO DEL RECHAZO" (multiline) to
  reject. Once sent, the screen says "Has aprobado / rechazado el cambio" with one button, "Volver al inicio", and the
  card goes.

Navigation: bottom tab bar with 5 tabs (Inicio · Obra · Fotos · Documentos · Perfil). Warranty,
Contact and Password are pushed screens with a back chevron and no tab bar. Primary actions in
pushed screens sit in a fixed bottom bar.

### Offline (no mockup: extends the same language)

Inicio, Obra and Fotos open on the last data the phone loaded, then refresh. When the refresh fails for
lack of a connection the stored data stays and a quiet note sits under the header: a 14 px `wifi-off`
line icon in muted and "Sin conexión · datos del 22 sept, 14:05" (13 px muted, no colour, no banner, no
alert tone). It goes as soon as the network answers; without stored data the usual error with "Reintentar"
shows. A photo never downloaded shows a surface-coloured tile with a muted `image` icon, never an error.

### Store release (2026-11-15): where the app differs from the mockups

- **Acceso:** "¿Has olvidado tu contraseña?" as drawn; tapping it unfolds a short note under it (the
  builder sets a new password; there is no reset email), muted 13 pt, centred. Tapping again folds it.
- **Perfil:** the three notification toggles as drawn; "Mensajes del equipo" covers a change to approve
  and the answer to a warranty claim. "Ayuda y preguntas frecuentes" and "Privacidad y datos" are drawn as in the
  mockup (52 pt rows, no icon, above "Cerrar sesión") but each shows only when the build sets its page.
- **Perfil, foot (not drawn):** below "Cerrar sesión", a quiet row "Solicitar la baja de mi cuenta"
  (14 pt, `muted`). Once asked: "Baja solicitada el 12 nov 2026" (15 pt), a meta line, and "Retirar
  la solicitud" in `verdeOlivaLight`.
- **Solicitar la baja (not drawn):** a pushed screen like the others: back link "Perfil", title
  (30/300), an intro and three points with a small `verdeOlivaLight` dot (the builder is told and will
  get in touch; the account stays active and the request can be withdrawn; contract documents may
  have to be kept by law), and "Solicitar la baja" as the primary button in the bottom bar.

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
- **Segmented progress:** one segment per step (10 hitos on Pagos), 4 px high, gap 4; done = `#8a9b62`, empty = `#3c3c37`.
- **Timeline:** 24 px markers — done = filled `#4a5e2c` with a check, current = `#8a9b62` ring with a dot and an expanded card, upcoming = `#4a4a45` ring with muted text.
- **Switch:** 52×32, on `#6b7a4a` with a light knob, off `#3c3c37` with a `muted` knob.
- **Tab bar:** height 84 including the bottom inset, `#181817`, 5 equal items, icon above a 10 pt label; active = `#e8e7e2`, inactive = `#8a8a84`.
- Touch targets are at least 44×44.

## Data the design needs (beyond today's `projects` table)

The current project model is only `ref`, `address`, `start_date`, `completion_date`. The design also
needs the following. Add each one to `packages/core` + `/api/v1` (backwards compatible) as the
feature is built:

- Collection name; overall progress %; status ("En plazo"); week N of M (derivable from the dates).
- The construction process (`features/construction_process/PROCESS.md`): stage 1–8, the budget's chapters with executed %, and hitos H0–H9 with status, acta and invoice.
- Photo updates: date, week, phase, caption, author, photos.
- Documents: category, type, size, date, "new" flag, locked-until-handover flag, download URL.
- Warranty claims: type, room, description, photos, urgent flag, status list ("Mis solicitudes").
- Assigned site manager (name, phone, email, availability), office info, visit slots and requests. *Built: site
  manager (name, phone, email) and office info (`GET /api/mobile/contact`); not yet: availability, visits.*
- Client profile (name, email), password change, notification preferences, language preference.
