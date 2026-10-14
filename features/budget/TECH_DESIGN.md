# Budget (Presupuesto) — technical design

Status: **approved** · 2026-10-11

- Approved UI design: https://claude.ai/artifact/6zrKmmGA9zgwC7A8vwyYPk (14 artboards)
- PDF template: `PreFRAMER_Caviedes_Valdadiga_V1.pdf` (in this folder)
- AI prompts: `PROMPTS_IA.md` §1 (in this folder)
- Process: `features/construction_process/PROCESS.md` §3 (budget), §4 (hitos)

## 1. What we are building

| # | Requirement | How |
|---|---|---|
| 1 | The budget is created automatically | AI pipeline (Claude) over the project documents, running in the background as a Vercel Workflow |
| 2 | Staff can modify it | Draft editor: summary, line items, options, PDF texts, conditions |
| 3 | Drafts, as the construction industry does them | One working draft per project, `Rev.n`. Issuing it to the client freezes it. The client accepts or rejects it, and any change becomes `Rev.n+1`, a copy of the previous one with a required reason and a diff |
| 4 | Two PDFs, general and detailed | Rendered on the server with `@react-pdf/renderer` in the Caviedes layout. Both are stored as project documents when the revision is issued |
| 5 | Always 20 chapters plus options | Fixed chapters 01–20 (codes fixed, names editable). Options sit below them as separate items with lines numbered `OP.01…`, outside the PEC |
| 6 | The first draft comes from the documents | From 1 to 4 documents: planos, proyecto básico, proyecto de ejecución, mediciones (PDF, images, BC3, Excel) |
| 7 | All 4 documents and both PDFs appear in Documentos | Documents get a `visible_to_client` flag. By default only the general PDF is visible in the app |

Out of scope for now: editing the price base (it ships as fixed data), AI classification of documents (`PROMPTS_IA.md` §2), mediciones held as a DB entity (the converter is built so it can come from the DB later, §6.3), and the old 17-chapter budget of VTH-26-001 (ignored; the seed is replaced, §13).

## 2. Architecture

```
Portal (apps/web)                             Core (packages/core)                     External
─────────────────                             ────────────────────                     ────────
budget/* pages ── server actions ──┐
                                   ├──► budget.ts            (revisions, chapters, lines, statuses)
/api/v1/projects/:id/budget/* ─────┘    budget-options.ts    (OP items)
                                        budget-template.ts   (20 chapters, default texts, contract)
                                        price-base.ts        (FRAMER 2026, ~230 items, fixed data)
                                        budget-review.ts     (AI checklist, €/m² ratios)
                                        budget-pdf/*.tsx     (react-pdf: general + detailed) ──► Blob (private)
                                        documents.ts         (+ visibility, + budget docs)   ──► Blob (private)
                                        budget-ai/*          (prompts, schemas, pipeline)     ──► Claude API (+ Files API)
workflows/generate-budget.ts ─ "use workflow" / "use step" ─► budget-ai/pipeline.ts
/api/v1/.../uploads ── @vercel/blob/client token ──────────────────────────────────────────► Blob (direct browser upload)
```

The layering doesn't change from what CLAUDE.md describes: all logic is in core and takes `ctx`; server actions and `/api/v1` routes are thin. The only new kind of file is `apps/web/workflows/generate-budget.ts`. It just orchestrates; each step calls one core function.

## 3. Data model

All changes are additive (prod rule). Migration file: `packages/db/sql/2026-10-budget.sql`. It is applied by hand, as before.

### 3.1 `budget_revisions`: new values and columns

```sql
ALTER TYPE budget_revision_status ADD VALUE IF NOT EXISTS 'issued';
ALTER TYPE budget_revision_status ADD VALUE IF NOT EXISTS 'rejected';

ALTER TABLE budget_revisions
  ADD COLUMN model         text,          -- 'framer20' for the new model; null = legacy budget (free chapters)
  ADD COLUMN contingency_bp integer NOT NULL DEFAULT 500,   -- chapter 20: 5 % of 01–19
  ADD COLUMN quality       text,          -- 'framer' | 'project' (the AI's "calidades")
  ADD COLUMN texts         jsonb,         -- everything the PDFs print besides numbers (§3.6)
  ADD COLUMN conditions    jsonb,         -- validity, term, penalty, signing place, includes (§3.6)
  ADD COLUMN review        jsonb,         -- AI checklist state: { done: string[] } (§5.4)
  ADD COLUMN change_reason text,          -- "Motivo de la revisión", required to issue Rev ≥ 1
  ADD COLUMN issued_on     date,
  ADD COLUMN valid_until   date,
  ADD COLUMN accepted_on   date,          -- what staff typed; accepted_at stays the system time
  ADD COLUMN accepted_by   text,
  ADD COLUMN rejected_on   date,
  ADD COLUMN generation_id text;          -- the AI run that created it (Rev.0 only)
```

Status lifecycle:

```
draft ──issue──► issued ──accept──► accepted ──(a later revision accepted)──► superseded
  │                 └──reject──► rejected
  └──accept (legacy /api/v1 path, no PDFs)──► accepted
```

- At most one `draft` per project, as today. A new revision may start when the newest one is `issued`, `rejected` or `accepted` (today: "not draft").
- `issued` and `rejected` are read-only, like `accepted`.
- Only `accepted` drives Obra, Pagos and the app, as today.
- Accepting a revision supersedes the previous `accepted` one and any older `issued` or `rejected` ones.

### 3.2 `budget_chapters`: chapters and options in one table

```sql
ALTER TABLE budget_chapters
  ADD COLUMN kind          text NOT NULL DEFAULT 'chapter',  -- 'chapter' | 'option'
  ADD COLUMN pdf_note      text,     -- chapter: the "Sustituye a…" note; option: its presentation text
  ADD COLUMN option_kind   text,     -- 'extra' | 'alternative' | 'deduction' (options only)
  ADD COLUMN replaces_line text,     -- alternative: the line code it replaces, e.g. "10.02"
  ADD COLUMN chosen        boolean;  -- options: set when the revision is accepted (null before)
```

Why reuse the table: an option is a group of lines, just like a chapter. Copying to a new revision, loading, progress, comparing with the previous revision, and mapping to a hito by code (`obra_hito_chapters.chapter_code`) all work unchanged.

- **Chapters:** codes `01`–`20`, always all 20, created with the revision from `budget-template.ts`. They can be renamed but not added or deleted.
- **Options:** group code `OP1`, `OP2`… (stable, never renumbered, so hito mapping survives). Their lines are numbered `OP.01`, `OP.02`… continuously across all options in display order, and renumbered automatically on every option write while the revision is a draft.
- **Chapter 20** has one computed line `20.01` (unit `pa`, quantity 1, price = `contingency_bp` × the total of 01–19). It is recalculated inside every draft write (`syncContingency(tx, revisionId)` in `inDraft`), so the totals SQL, progress and copies keep working with no special cases. It is flagged as computed (below) and read-only in the UI.
- Options never get the 5 % (as in Caviedes).

### 3.3 `budget_lines`

```sql
ALTER TABLE budget_lines
  ADD COLUMN source     text NOT NULL DEFAULT 'manual',  -- 'base' | 'estimated' | 'manual' | 'computed'
  ADD COLUMN base_code  text,     -- price base code it came from, e.g. "03.14"
  ADD COLUMN note       text;     -- the AI's (or staff's) note: "Medido en los planos 10–11…"
```

`unit_price_cents` may be negative on option lines only, for deductions (core validates this; the column already allows it). Chapter lines stay ≥ 0.

### 3.4 `project_documents`

```sql
ALTER TYPE document_category ADD VALUE IF NOT EXISTS 'budget';

ALTER TABLE project_documents
  ADD COLUMN visible_to_client  boolean NOT NULL DEFAULT true,  -- existing documents stay visible
  ADD COLUMN content_type       text NOT NULL DEFAULT 'application/pdf',
  ADD COLUMN filename           text,          -- original name, for downloads of BC3/XLSX
  ADD COLUMN budget_input       text,          -- 'plans' | 'basic' | 'execution' | 'measurements'
  ADD COLUMN budget_revision_id text REFERENCES budget_revisions(id) ON DELETE SET NULL,
  ADD COLUMN budget_pdf         text,          -- 'general' | 'detailed'
  ADD COLUMN claude_file_id     text;          -- Files API id, reused across generations
```

- The documents the AI read have `budget_input` set and are staff-only.
- The PDFs of issued revisions have `budget_revision_id` and `budget_pdf` set. Neither kind can be deleted from Documentos (`budget_document` error). Only visibility can change.

### 3.5 New tables

```sql
CREATE TABLE budget_generations (            -- one AI run
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  status text NOT NULL,                       -- queued | running | succeeded | failed | cancelled
  step integer NOT NULL DEFAULT 0,            -- 0–5, for the progress bar
  log jsonb NOT NULL DEFAULT '[]',            -- [{at, step, kind: info|done|error, text, data?}]
  options jsonb NOT NULL,                     -- { reference, quality, vatRateBp }
  document_ids text[] NOT NULL,
  extracted jsonb,                            -- step 1 result (PROMPTS_IA "ia_datos")
  groups jsonb,                               -- steps 2–5 results, by group index (makes retries idempotent)
  revision_id text REFERENCES budget_revisions(id) ON DELETE SET NULL,
  workflow_run_id text, error text,
  created_by_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE ai_usage (                       -- one row per Claude call (PROMPTS_IA "ia_uso")
  id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  project_id text REFERENCES projects(id) ON DELETE SET NULL,
  generation_id text REFERENCES budget_generations(id) ON DELETE SET NULL,
  purpose text NOT NULL,                      -- 'budget.extract' | 'budget.group.0' …
  model text NOT NULL,
  input_tokens integer NOT NULL, output_tokens integer NOT NULL,
  cache_read_tokens integer NOT NULL DEFAULT 0, cache_write_tokens integer NOT NULL DEFAULT 0,
  cost_microusd bigint NOT NULL,              -- from a price table in budget-ai/pricing.ts
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE tenants
  ADD COLUMN ai_monthly_limit_cents integer,   -- null = no limit
  ADD COLUMN letterhead jsonb;                 -- PDF letterhead: {name, tagline, address, phone, logoPathname} (§4)
```

### 3.6 `texts` and `conditions` (JSON, typed in `contract.ts`)

```ts
type BudgetTexts = {
  cover: { promoter: string; site: string; cadastral: string; surfaces: string; program: string;
           basis: string; scope: string; system: string };            // the cover table
  justification: { intro: string; blocks: { title: string; text: string }[] };
  measurementCriterion: string;
  annex: { id: string; kind: "inconsistency" | "assumption" | "note"; title: string; text: string }[];
  exclusions: string[];                                               // replaces budget_revisions.exclusions (kept for v1)
  includes: string;                                                    // "Este presupuesto sí incluye…"
};
type BudgetConditions = { validityDays: number; term: string; penalty: string; signingPlace: string };
```

They are validated in core (lengths, counts) with plain parsers, matching the existing input helpers. Both are copied to each new revision.

### 3.7 Money and totals

- **Cost** = the sum of the lines in `kind = 'chapter'` (01–20). **PEC** = the same lines at price: each unit price with gastos asociados (`overhead_bp`) and beneficio industrial (`profit_bp`) in (§18).
- **Contract price** of an accepted revision = PEC + the price of the options with `chosen = true` (their lines priced the same way).
- `loadBudget()` (what Obra, Pagos and the app read) loads the chapters plus the chosen options, so `progress.totalCents`, and through it every hito amount, already uses the contract price. Unchosen options are invisible to Obra and the app.

## 4. Fixed data in core

- **`budget-template.ts`:** the 20 FRAMER chapters (code and default name, from Caviedes); default `texts` (justification intro, measurement criterion stub, exclusions, includes); LOE guarantees; handover documents; and the 16 contract clauses with `{placeholders}` (promoter, plot, price, term, penalty, signing place).
- **`price-base.ts`:** the FRAMER 2026 base (≈230 rows: `code | description | unit | price`), taken from the reference artifact. It has a `searchPriceBase(query, chapter?)` function (accent-insensitive). Editing it in the portal is a later feature.
- **Company letterhead** (logo, name, address, phone) for the PDFs: a `tenants.letterhead jsonb` column plus the logo in Blob. For now it's set by the seed and by SQL; there's no settings screen yet.

## 5. Core services

### 5.1 `budget.ts` (changes)

| Function | Change |
|---|---|
| `getBudget` | Returns `chapters` (01–20 only, which keeps v1 compatible) plus new `options`, `pecCents`, `contractTotalCents`, `texts`, `conditions`, `contingencyBp`, `status` (new values), `issuedOn`, `validUntil`, `changeReason`, `documents` (its PDFs), `generation`, `checks` (§5.4) |
| `createBudget` | Creates Rev.0 with the 20 chapters and default texts (`model = 'framer20'`). Kept for v1; the portal creates budgets only through the AI |
| `createRevision` | Also allowed from `issued`/`rejected`. Copies options (with `chosen` reset), texts, conditions and contingency. Clears `change_reason` and `review` |
| `updateRevision` | Also accepts `texts`, `conditions`, `contingencyPct`, `quality`, `changeReason`, `review` |
| `issueRevision` (new) | Draft → issued. Requires `changeReason` for Rev ≥ 1. Renders both PDFs (§7), stores them as documents (general: visible if `shareWithClient`), sets `issued_on`/`valid_until`, then `markChanged(['documents'])` if anything visible, plus a push |
| `acceptRevision` | From `issued` (or `draft`, legacy). Body `{ acceptedOn?, acceptedBy?, chosenOptionIds? }`; an empty body behaves exactly as today. Sets `chosen` on options, supersedes older revisions, carries progress over. `markChanged(['obra'])` |
| `rejectRevision` (new) | Issued → rejected |
| `addChapter`/`deleteChapter` | In `framer20` budgets, chapters can't be added or deleted (`fixed_chapters`). Options go through `budget-options.ts`. Legacy budgets behave as today |
| `updateLine`/`addLine` | New fields `note`; on `addLine`, `baseCode` copies the description, unit and price from the price base |
| `inDraft` | After every write: `syncContingency` and `renumberOptionLines` |

### 5.2 `budget-options.ts` (new)

`addOption(ctx, projectId, revisionId, { name, optionKind, intro?, fromBaseCodes?[] })`, `updateOption`, `deleteOption`, `reorderOptions`. `optionFromLine(ctx, projectId, lineId, kind)` creates an alternative or a deduction from a line (the line menu "⚑ Ofrecer como deducción", "Crear una alternativa"):

- a **deduction** copies the line with a negative price;
- an **alternative** records `replaces_line` and starts with a line holding the replacement description, which staff then price.

Option lines use the normal line functions (code assigned automatically).

### 5.3 `documents.ts` (changes)

- `listDocuments` returns `visibleToClient`, `contentType`, `budgetInput`, `budgetRevisionNumber`, `budgetPdf`.
- `setDocumentVisibility` (new) then `markChanged(['documents'])`.
- `listClientDocuments` and `openClientDocument` filter on `visible_to_client`. **This is the only change on the app's side, and it happens on the server.**
- Notifying the client only happens for visible documents.
- `registerUploadedDocument` (new) inserts the row for a file the browser has already put in Blob (§8).

### 5.4 `budget-review.ts` (new): the "Antes de emitir" checklist

The checklist is computed, never stored, except which items are done (`review.done`, keys like `annex:<id>`, `line:<code>`, `ratio:<chapter>`). Its items:

- the annex items of kind `inconsistency` or `assumption`;
- lines with `source = 'estimated'`;
- chapters whose €/m²c is more than 35 % from the tenant's average across its other issued or accepted budgets that have a built area. This is computed with one grouped query; there's no average yet when the tenant has none.

Issuing with open items is allowed; the dialog warns.

## 6. AI generation

### 6.1 Flow

1. **Upload.** On the Budget tab, staff upload or pick 1–4 documents (§8). They become `project_documents` with `budget_input` set.
2. **Start.** `startGeneration(ctx, projectId, { documentIds, reference, quality, vatRateBp })` checks that:
   - there's no budget and no running generation (`budget_exists` / `generation_running`);
   - the tenant's monthly AI limit isn't reached (`ai_limit_reached`).

   It then inserts `budget_generations` (status `queued`) and the action calls `start(generateBudget, [generationId])`.
3. **Progress.** The portal polls `getGeneration` (server action, every 3 s while the page is open; `router.refresh()` when it finishes). Closing the page doesn't matter.
4. **Finish.** The last step creates Rev.0 as a draft and links it (`generation_id`). The Budget tab then shows the draft with its checklist.

### 6.2 Workflow (`apps/web/workflows/generate-budget.ts`, Workflow SDK, `workflow` + `workflow/next`)

```ts
export async function generateBudget(generationId: string) {
  "use workflow";
  await prepareInputs(generationId);            // step: status running; PDFs → Files API (claude_file_id, reused); BC3/XLSX → text
  await extractProject(generationId);           // step: Claude Opus 5.5 reads everything → generations.extracted
  await generateGroup(generationId, 0);         // step: Sonnet 5.5, chapters 01–05 (writes the prompt cache)
  await Promise.all([1, 2, 3].map((g) => generateGroup(generationId, g)));   // 06–10, 11–15, 16–19 (cache hits)
  await saveDraft(generationId);                // step: post-process (§6.5) → Rev.0, texts, hitos
}
```

- Each step is a one-line wrapper (`"use step"`) around a core function in `budget-ai/pipeline.ts`. That function stores its result in `budget_generations` and returns nothing big, so retries are idempotent: a step that finds its result already stored returns at once.
- **Retries:** Claude 429/5xx/overloaded become `RetryableError` (the SDK already retries twice). A schema failure after one corrective retry, a refusal, or `max_tokens` become `FatalError`, which records `failed` and the message staff see ("La respuesta de la IA no tenía el formato esperado…").
- **Cancel:** `cancelGeneration` sets `cancelled` and cancels the run. Each step checks the status first and stops.
- **Timeouts:** every Claude call streams (`.stream().finalMessage()`). The step routes need `maxDuration` up to 800 s for step 1 on big projects; this setting is checked during implementation against the installed Workflow docs.

### 6.3 Inputs

| Input | Sent as |
|---|---|
| PDF (plans, basic, execution, PDF measurements) | Files API (`client.files.upload`, then `{type:"document", source:{type:"file", file_id}}`). This avoids the 32 MB request limit (the example's three PDFs alone are 36 MB). Limit: 600 pages per request; above that the step fails with `too_many_pages` and a clear message |
| Images (photos of plans) | `image` blocks, scaled to ≤ 2000 px with `sharp` |
| BC3 (FIEBDC-3) | `budget-ai/bc3.ts`: our own small parser for `~C` (concept) and `~M` (measurement) records, output as `code | description | unit | quantity` text |
| XLSX/XLS/ODS | `budget-ai/sheet.ts` (`exceljs`), one CSV per sheet |

The converters return rows, not text. Text is rendered from the rows, so later the mediciones can come from a DB table instead of a file without touching the prompts.

### 6.4 Claude calls (`budget-ai/claude.ts`)

- **Models** (as `PROMPTS_IA.md` says): step 1 `claude-opus-5-5`; steps 2–5 `claude-sonnet-5-5`. Adaptive thinking (the default); effort `high` for step 1 and `medium` for the groups (tuned once on real projects). Server-side refusal fallback `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`).
- **Structured output:** `output_config.format` with Zod schemas (`budget-ai/schemas.ts`), via the SDK's `zodOutputFormat`. This replaces "Responde SOLO con JSON" and makes invalid JSON a rare case. Business rules (codes inside the group, units) are validated after parsing; one corrective retry, then fail.
- **Step 1 schema** = `PROMPTS_IA` step 1, extended with what the Caviedes PDF needs:
  - cover texts (program, basis, scope, system);
  - justification blocks `[{title, text}]`;
  - measurement criterion (it must say whether mediciones were provided);
  - a note per chapter (`{code, note}`, e.g. "Sustituye a…");
  - annex items (`{kind, title, text}`, built from the inconsistencies and assumptions).
- **Steps 2–5 schema** = `PROMPTS_IA` steps 2–5 (`capitulos[{cod, partidas[{cod, desc, ud, med, pu, fuente, nota}]}]`).
- **Prompt caching:** groups share one prefix: system prompt, then step-1 JSON, then mediciones text (`cache_control` breakpoint). The filtered price base and the group's instruction come after it. Group 0 runs first to write the cache; groups 1–3 run in parallel and read it.
- **Usage:** every call writes `ai_usage` (tokens incl. cache, cost from `pricing.ts`).
- **Cost:** a 166-page project is ≈ $3–4 per generation (step 1 ≈ 500k input tokens dominates). Time is ≈ 4–6 min.
- **Client and key:** one `new Anthropic()` in core (`ANTHROPIC_API_KEY`). Tests replace the module with a fake (`vi.mock("@repo/core/claude", () => import("@repo/core/testing"))`), the same pattern as storage.

### 6.5 Post-processing (pure, `budget-ai/postprocess.ts`, unit-tested)

As `PROMPTS_IA.md` says:

- Drop lines with quantity or price ≤ 0.
- Codes outside the group's chapters are dropped and logged.
- `fuente = "estimado"` becomes `source = 'estimated'`; `base` lines whose code exists in the price base get `base_code`.
- Quantities are rounded to 3 decimals and prices to cents.
- Chapter 20 is computed (§3.2).
- Rev.0 gets `texts` from step 1, `quality`, `reference`, the VAT rate and the surfaces (`m2c`, `m2u`); the default hitos are created if missing.

The `extracted` JSON stays on the generation (PROMPTS_IA `ia_datos`).

### 6.6 Privacy

The documents contain personal data. Anthropic's API data terms apply, and the processing has to be recorded in the register of processing activities (`PROMPTS_IA.md`). This is a task for the business, not code. The generation stores nothing beyond what's listed above.

## 7. PDFs (`packages/core/src/budget-pdf/`)

- `@react-pdf/renderer` (pure JS, runs in a Vercel function, no Chromium). Components follow the Caviedes template one to one:
  - black bands with amber headings, header table, cream subtotal rows;
  - the black footer is `fixed` on every page, and table headers repeat on page breaks;
  - fonts are DejaVu/Noto Sans TTF files committed under `budget-pdf/fonts/` and listed in `outputFileTracingIncludes`.
- `renderBudgetPdf(revisionView, letterhead, kind: 'general' | 'detailed', { draft })` returns a `Buffer`. Drafts get a diagonal "BORRADOR" watermark.

| Section (Caviedes order) | General | Detailed |
|---|---|---|
| Cover with data table + PEC box | ✓ | ✓ |
| Justificación técnica + criterio de medición | ✓ | ✓ |
| Resumen por capítulos (+ IVA note, + "precio cerrado" box) | ✓ | ✓ |
| Presupuesto detallado: chapters 01–20 with notes, €/m²c, €/m²u, subtotals, 20.01, total | — | ✓ |
| Partidas opcionales | totals per option | every OP line, intro text, total |
| Plan de pagos H0–H9 | ✓ | ✓ |
| Gastos no incluidos + "sí incluye" | ✓ | ✓ |
| Garantías LOE · Documentación a entregar | ✓ | ✓ |
| Resumen de revisiones (Rev ≥ 1) | ✓ | ✓ |
| Contrato de obra (16 clauses, signatures) | — | ✓ |
| Anexo: observaciones técnicas | ✓ | ✓ |

- **Preview:** `GET /api/v1/projects/:id/budget/revisions/:rid/pdf?kind=…` renders on the fly (session cookie or Bearer). The portal's viewer page (artboards 12–13) shows it in an `<iframe>`, with the General/Detallado switch and a download button.
- **Issued revisions:** the endpoint serves the stored document, never a re-render. What was sent is what you get.

## 8. Documents and large uploads

- Budget inputs are often far above today's 4 MB cap (the example's plans: 18 MB), so the browser uploads straight to the private Blob store (`@vercel/blob/client` `upload(…, { access: 'private', multipart: true })`).
- **Token handler:** `POST /api/v1/projects/:id/documents/uploads`, built on `handleUpload`. It checks the session (editor, project in tenant), forces the pathname under `projectFolder()`, and sets allowed types (PDF, JPEG/PNG/WebP, BC3, XLSX/XLS/ODS) and a 100 MB cap.
- **Register:** the client then calls `registerUploadedDocument` (action or `POST …/documents/register`). It checks the blob exists under the project's folder (`head`), checks the content (PDF magic bytes, etc.) and inserts the row.
- Normal document uploads keep today's path.
- **Documentos tab** (artboard 11):
  - documents grouped as "Presupuesto <ref>" and "Otros documentos";
  - each row has a "En la app / Solo equipo" switch;
  - budget documents have no delete button;
  - non-PDF types show their extension badge.

## 9. Portal (`apps/web`)

### 9.1 Routes

Under `dashboard/projects/[id]/budget/`, a `layout.tsx` loads the budget once. It renders the header, the stepper (Documentación → Borrador → Emitido → Aceptado), the actions and the sub-tabs. `?revision=` still selects an older revision.

| Route | Artboard | Container → views |
|---|---|---|
| `budget/` (no budget) | 1 | `BudgetStartScreen` → `DocumentSlots`, `GenerationForm`, `WhatHappensNext` |
| `budget/` (generation running/failed) | 2 | `GenerationScreen` → `GenerationProgress`, `ExtractedFacts` |
| `budget/` | 3 | `BudgetSummaryScreen` → `ReviewChecklist`, `BudgetKpis`, `ChapterSummaryTable`, `OptionSummaryTable` |
| `budget/lines/[code]` | 4 | `BudgetLinesScreen` → `ChapterNav`, `ChapterHeader`, `LineTable` (inline cells, row menu), `PriceBasePicker` |
| `budget/options` | 5 | `BudgetOptionsScreen` → `OptionCard`, `OptionLines`, `AlternativeSwap` |
| `budget/texts` | 6 | `BudgetTextsScreen` → `CoverForm`, `JustificationBlocks`, `AnnexList` |
| `budget/conditions` | 7 | `BudgetConditionsScreen` → `PaymentPlan` (reuses hitos), `ExclusionsList`, `ContractFields` |
| `budget/revisions` | 10 | `BudgetRevisionsScreen` → `RevisionTimeline`, `RevisionDiff` |
| `budget/pdf` | 12–13 | `BudgetPdfScreen` (iframe viewer) |
| dialogs | 8, 9 | `IssueDialog`, `AcceptDialog` (live contract total), reject confirm |
| `documents/` | 11 | `DocumentsScreen` + `DocumentList` (groups, visibility switch) |

- Each page's container is the only file that calls actions (`actions/budget.ts`, new `actions/budget-ai.ts`, `actions/documents.ts`); views take props only.
- Inline edits save on blur, with a "Guardado" indicator.
- Shared formatting stays in `components/obra/format.ts`.
- Payment plan mapping (`PlanForm`) also lists accepted options next to chapters.
- Mobile layout as in artboard 14: tabs scroll sideways, tables become stacked rows below `md`, and there's a sticky bottom bar with PDF + Emitir.
- All text goes in `es.json` and `en.json` (namespace `obra.budget.*`, `budget.ai.*`).

### 9.2 What goes away

- The current `BudgetScreen.tsx` editor (free chapters, `window.print()` export, the "create budget" dialog).
- Its views `BudgetChapters` / `BudgetChanges` are replaced by the views above; `Kpi`, `InlineNumber` and `StatusPill` are reused.

## 10. `/api/v1` (additive; existing calls keep their shape)

| Method | Route | Core |
|---|---|---|
| POST | `/budget/generations` · GET `/budget/generations/:gid` · POST `…/:gid/cancel` | `startGeneration` · `getGeneration` · `cancelGeneration` |
| GET | `/budget/price-base?q=&chapter=` | `searchPriceBase` |
| POST | `/budget/revisions/:rid/issue` · `…/reject` | `issueRevision` · `rejectRevision` |
| POST | `/budget/revisions/:rid/accept` (body now optional `{acceptedOn, acceptedBy, chosenOptionIds}`) | `acceptRevision` |
| GET | `/budget/revisions/:rid/pdf?kind=general\|detailed` | `renderRevisionPdf` / stored document |
| POST | `/budget/revisions/:rid/options` · PATCH/DELETE `/budget/options/:oid` · POST `/budget/lines/:lid/option` | `budget-options.ts` |
| PATCH | `/budget/revisions/:rid` (new fields), `/budget/lines/:lid` (new fields) | existing |
| POST | `/documents/uploads` (token) · `/documents/register` · PATCH `/documents/:did` `{visibleToClient}` | §8, §5.3 |

- `GET /budget` keeps `revision.chapters` (01–20 only) and adds `options`, so old readers see the same data.
- New error codes: `fixed_chapters`, `not_issued`, `change_reason_required`, `generation_running`, `ai_limit_reached`, `too_many_pages`, `budget_document`.

## 11. Mobile app

**No screen changes.**

- **Documents:** the server now filters on `visible_to_client`. The app shows the general PDF of each issued revision that was shared, with no other change, and gets the usual push.
- **Obra and Pagos:** amounts follow the contract price (PEC + chosen options) through `loadBudget`. An option mapped to a hito shows inside that phase like a chapter (`OP1 · Piscina…`).
- **Tests:** existing jest-expo tests stay green. Server tests cover the filter.

## 12. Live updates (`changes.ts`)

New writes and the counters they mark (each gets a case in `changes.test.ts`):

- `issueRevision` → `documents`, only when a PDF is visible
- `acceptRevision` → `obra` (as today)
- `setDocumentVisibility` → `documents`
- `registerUploadedDocument` → `documents`, only when visible (budget inputs aren't)

Draft edits, options, texts and generations → none: the app only sees accepted revisions.

## 13. Seed and test data

`pnpm db:seed` replaces Castrillón with the **Caviedes** budget from the template PDF: 004/2026, 20 chapters with all their lines, chapter notes, 20.01, the pool as OP.01–OP.11, texts, hitos. It's an accepted Rev.0 on VTH-26-001, so Obra and the app have real data, and the PDFs can be compared page by page against the original. The data is extracted once with `pdftotext` into `seed/caviedes.ts`.

## 14. Testing

| Layer | What |
|---|---|
| Core (Vitest, real DB) | 20-chapter creation; contingency sync on every write; OP renumbering; PEC vs contract totals; the status machine (issue/accept/reject/new revision, every forbidden transition); copying options/texts; accept with chosen options; progress carry-over; checklist + ratios; documents visibility and mobile filter; budget documents undeletable; tenant isolation for every new function; generation start rules, limit, cancel |
| `budget-ai` (fake Claude) | Each step stores its result and is idempotent on retry; schema-invalid response, then one retry, then fail; refusal / max_tokens → failed with message; usage rows; post-processing (pure); BC3 and XLSX converters with fixture files; prompt building (the price base slice per group) |
| PDF | Renders both kinds for the seed budget without error; page count and key strings (`TOTAL PEC`, `OP.01`, `Cláusula 16ª`) via `pdf-parse`; draft watermark present only on drafts |
| Server actions + `/api/v1` | Happy path, errors, v1 backwards compatibility (old accept body, `chapters` shape), tenant isolation |
| Workflow | Steps unit-tested as plain functions. The orchestration is 6 lines and is smoke-tested locally with `npx workflow web` |
| Portal | Container/view tests in the existing style for every screen and dialog |
| Mobile | Existing suites; no new app code |

## 15. Rollout

1. Env: `ANTHROPIC_API_KEY` (Vercel all environments and `.env.local`). Enable Vercel Workflow on the project; it is billed per step on top of functions.
2. Prod: apply `packages/db/sql/2026-10-budget.sql` before deploying. Existing budgets stay legacy (`model` null) and keep working read-only/editable as today. Set the FRAMER letterhead with one SQL `UPDATE`.
3. Deploy, then smoke-test on prod: generate a budget for a test project from the Caviedes plans; check both PDFs, issue, accept, the app's documents and Obra.

## 16. Implementation plan (each step = commit(s) that pass the gate)

1. **Model:** migration and schema, template, contingency, options, statuses, totals, documents visibility and filters; core tests; v1 routes; seed (Caviedes).
2. **PDF:** `budget-pdf`, preview route, `issueRevision` storing documents; tests.
3. **AI:** `budget-ai` (converters, schemas, prompts, Claude client, usage, post-processing), workflow, direct uploads, generation actions/routes; tests with a fake Claude.
4. **Portal:** start and generating screens, summary, lines and price base picker, options, texts, conditions, revisions, issue/accept dialogs, PDF viewer, Documentos tab, PlanForm options; es/en; tests.
5. **Review:** `/simplify`, `/code-review`, fixes; full gate; deploy; smoke test.

## 17. Decisions (2026-10-11)

1. Chosen options are part of the contract price and are paid through the H0–H9 hitos (each hito is its % of PEC + chosen options).
2. The finished-generation notice is in the Budget tab only (plus a toast while it is open).
3. No monthly AI limit for now (the column stays null; usage is still logged per call).
4. Vercel Workflow runs the generation.
5. Admins and managers generate, edit, issue and accept; viewers read.

## 18. Margins (2026-10-14, client feedback "Modificaciones plataforma")

Budgets are built from **costs**, then a % of **gastos asociados** and of **beneficio industrial** goes on top.
Both matter more to staff than VAT, so they lead the summary tab.

- `budget_revisions.overhead_bp` / `profit_bp` (bp of the cost). A new revision starts at 13 % + 6 %
  (`DEFAULT_MARGINS`), a copy keeps its source's, and existing rows got 0 (their unit prices already included both;
  `packages/db/sql/2026-10-budget-margins.sql`). PATCH takes `overheadPct` / `profitPct` on drafts.
- The FRAMER 2026 price base is now at cost: the prototype's prices ÷ 1.19. The AI prompt says the P.U. are costs.
  The Caviedes seed takes, for each line, the cost whose price comes back to the document's unit price; its PEC
  lands within a few euros of the document.
- Lines stay at cost. Prices are per line: the unit price with both margins in, to the cent (`unitPrice` /
  `priceLines` in `obra-calc.ts`; `linesPriceSql` in SQL), amount = quantity × unit price. A chapter's or option's
  `priceCents` and the PEC are plain sums, so every printed row multiplies out. The portal shows what the margins
  came to (PEC − cost) split between gastos and beneficio by their % (`marginsOn`).
- **The client never sees the margins apart.** Both PDFs (the detailed one carries the contract) print the priced
  lines (`forClient`), and the obra, hitos and the app read the contract the same way (`loadBudget`). Only the
  portal's summary shows cost, gastos and beneficio. A draft at 0 % shows a warning: its lines are at cost (budgets
  from before the margins copy 0 % into new revisions).
- €/m² (chapters, the KPI, the review's tenant averages) is at price, so budgets priced before the margins
  compare alike.
- Summary tab order: KPIs (importe de la obra, beneficio industrial, gastos asociados, €/m² and m²) →
  chapters (price and cost, then cost / gastos / beneficio / PEC) → options → the AI's review checklist.
