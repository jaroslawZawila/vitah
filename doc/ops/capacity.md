# Capacity: the portal at ten times a mid-size builder

Measured on 2026-11-14, on a developer machine (12 cores, Postgres 16 in Docker, Node 26), against a scratch database
filled by `pnpm db:seed:volume`. Until then the platform had only ever run with one demo obra (production
is 13 MB) and no list was paged, so nobody knew where it would break. This is where, and what was done.

**In short.** The database is not the problem at this volume: no statement takes more than 35 ms to
execute (most take under 5), and no index is missing. What broke was **how much the portal loaded and sent**:
four tenant-wide lists (orders, supplier invoices, payments, workers) sent every row to the browser, 4 to 8 MB
of HTML each, and several Compras reads loaded the whole subcontractor network (27,000 rows) to show a
supplier's CAE status. Those four lists are now paged and filtered on the server, and Compras loads only the
companies' own documents. The slowest page (Compras › Pedidos) went from 880 ms and 7.7 MB of HTML to 68 ms
and 0.45 MB; its read in core from 429 ms and 34,877 rows to 32 ms and 690.

## The dataset

`pnpm db:seed:volume` (`packages/core/src/seed/volume.ts`) fills two tenants. It refuses to run unless
`POSTGRES_URL` is on `localhost` / `127.0.0.1` **and** its database is not `vitah` (the dev one). It is
deterministic (seeded randomness; dates are relative to today, so the states stay true), replaces its two
tenants when run again, and takes about a minute. An optional argument scales it
(`pnpm --filter @repo/core db:seed:volume 0.1` for a tenth).

What happens once per obra goes through the services (the Caviedes budget at the obra's own size, accepted;
Avance's dates; the approved plan; the hitos' payments), so it is as valid as what staff enter. The thousands
of rows are inserted in bulk as the services would write them (orders with their lines and history, invoices
split across their order's lines, payments, requests, workers, documents with their versions and audit). No
file is uploaded: rows that name one (photos, PDFs) point at nothing.

| | Big tenant (`volumen-constructora`) | Small tenant (`volumen-reformas`) |
|---|--:|--:|
| Obras (3 in each of stages 1–4, 6 about to start, 30 under way, 6 handed over, 6 in warranty) | 60 | 4 |
| Obras with a budget in the 20-chapter model (48 accepted, 6 first drafts; 3 more drafts are changes over a contract) | 54, with 8,949 lines | 3 |
| Orders (38 per obra under way or finished) | 1,593 | 99 |
| Order lines / order history rows | 4,695 / 7,194 | 290 / 448 |
| Supplier invoices and credit notes / payments | 1,653 / 1,380 | 99 / 89 |
| Purchase requests | 301 | 19 |
| Companies (30 material suppliers, 11 self-employed) | 150 | 8 |
| Workers | 1,200 | 40 |
| CAE documents / their versions / audit rows | 8,594 / 9,057 / 19,432 | 302 / 326 / 698 |
| Companies assigned to obras | 479 | 15 |
| Incidents and changes / site photos | 480 / 3,494 | 31 / 340 |

The database is about 80 MB. The small tenant keeps tenant isolation honest: every number below is the big
tenant's, read as its admin (`admin@volumen.test`), with the small tenant's rows in the same tables.

## The method

1. **Core** (`pnpm db:bench`, `packages/core/src/seed/volume-bench.ts`): each read the portal performs is
   called as the page calls it, as the big tenant's admin. Per read: the server time (median of 7 runs after
   a warm-up), the SQL statements it sends and the rows the database returns to it (counted on the
   postgres.js client; `pg_stat_statements` is not loaded in the dev container), the items of its main list
   and the size of its result as JSON (what `/api/v1` sends, and about what the page's RSC payload carries).
2. **Plans**: `EXPLAIN (ANALYZE, BUFFERS)` on the slowest statements of each read, for both tenants.
3. **HTTP** (`node doc/ops/capacity-http.mjs`): the portal as a production build (`next build`,
   `next start --port 3210`) on the volume database, signed in through the app's own credentials login; per
   page the time to first byte (median of 5 after a warm-up), the HTML's size, raw and gzipped, and the RSC
   payload (what a navigation inside the portal downloads).

Budgets used to classify: server time under 300 ms is **good**, 300 ms to 1 s **needs attention**, over 1 s
**must fix**; a payload over 500 KB **must fix**; more than about 25 SQL statements for one page **needs
attention**.

**Noise.** Other test suites were running on the machine throughout (load average 4 to 6 on its 12 cores;
each table says its own). Times moved by 10 to 30 % between runs; statements, rows and sizes are exact.

## Before

Load average 4.34 3.70 3.65; median of 7 runs after a warm-up.

| Read | Page | Time (ms) | SQL | DB rows | Items | JSON | |
|---|---|--:|--:|--:|--:|--:|---|
| **Every page** | | | | | | | |
| `getPurchasingCounts` | dashboard layout (rail badges) | 13 | 1 | 1 |  | 96 B | good |
| `subcontractors getCounts` | dashboard layout (rail badges) | 16 | 3 | 347 |  | 47 B | good |
| **Tenant-wide** | | | | | | | |
| `listProjectsWithBudget` | /dashboard/projects | 15 | 3 | 114 | 60 | 33 KB | good |
| `listProjects` | GET /api/v1/projects, obra pickers | 2.5 | 1 | 60 | 60 | 29 KB | good |
| `listBudgets` | GET /api/v1/budgets | 71 | 14 | 10,965 | 60 | 32 KB | good |
| `listPurchases (unpaged)` | /dashboard/compras | 429 | 12 | 34,877 | 1593 | 1071 KB | **must fix** |
| `listInvoices (unpaged)` | /dashboard/compras/facturas | 63 | 5 | 4,411 | 1653 | 1457 KB | **must fix** |
| `listPayments (unpaged)` | /dashboard/compras/pagos | 77 | 4 | 5,576 | 1380 | 852 KB | **must fix** |
| `listRequests` | /dashboard/compras/solicitudes | 15 | 4 | 1,086 | 301 | 180 KB | good |
| `listSuppliers` | /dashboard/compras/proveedores | 349 | 14 | 39,463 | 150 | 48 KB | attention |
| `getSupplierPurchasing` | /dashboard/compras/proveedores/[id] | 11 | 15 | 365 | 36 | 68 KB | good |
| `loadNetwork (whole tenant)` | behind every Subcontratas list | 231 | 7 | 27,624 | 8594 | 60 B | good |
| `subcontractors getOverview` | /dashboard/subcontratas/empresas | 291 | 8 | 28,584 | 150 | 240 KB | good |
| `listSubcontractors` | GET /api/v1/subcontractors | 237 | 7 | 27,624 | 150 | 91 KB | good |
| `listWorkers (unpaged)` | /dashboard/subcontratas/trabajadores | 256 | 7 | 27,624 | 1200 | 1714 KB | **must fix** |
| `listWorkers (one obra)` | /dashboard/subcontratas/trabajadores?obra= | 235 | 7 | 27,624 | 149 | 214 KB | good |
| `listProjectOptions` | /dashboard/subcontratas/trabajadores | 5.7 | 2 | 1,020 | 60 | 78 KB | good |
| `getSubcontractor` | /dashboard/subcontratas/empresas/[id] | 19 | 10 | 796 |  | 114 KB | good |
| `getWorker` | /dashboard/subcontratas/trabajadores/[id] | 14 | 10 | 493 |  | 12 KB | good |
| **One obra (VOL-002)** | | | | | | | |
| `getProjectPurchaseLines` | /dashboard/projects/[id]/compras | 24 | 18 | 910 | 145 | 344 KB | good |
| `getProjectPurchases` | /dashboard/projects/[id]/compras?vista=pedidos | 66 | 21 | 4,248 | 52 | 35 KB | good |
| `listRequests (one obra)` | /dashboard/projects/[id]/compras?vista=solicitudes | 4.5 | 3 | 27 | 6 | 3.9 KB | good |
| `getPurchaseForm` | /dashboard/projects/[id]/compras/nuevo | 256 | 20 | 28,127 | 150 | 79 KB | good |
| `getPurchase` | /dashboard/projects/[id]/compras/[orderId] | 20 | 31 | 580 |  | 5.2 KB | attention |
| `getInvoice` | /dashboard/compras/facturas/[invoiceId] | 12 | 13 | 172 |  | 3.3 KB | good |
| `getControl` | /dashboard/projects/[id]/obra | 71 | 27 | 4,228 | 19 | 25 KB | attention |
| `getControlHeader` | every Obra and Compras page of the obra | 3.4 | 4 | 22 |  | 1.2 KB | good |
| `getCosts` | /dashboard/projects/[id]/obra/costes | 11 | 14 | 503 | 145 | 71 KB | good |
| `listIssues` | /dashboard/projects/[id]/obra/incidencias | 4.5 | 3 | 13 | 12 | 4.9 KB | good |
| `getPlanning` | /dashboard/projects/[id]/obra/planificacion | 11 | 14 | 314 |  | 12 KB | good |
| `getBudget` | /dashboard/projects/[id]/budget | 24 | 9 | 1,141 | 146 | 91 KB | good |
| `listHitos` | /dashboard/projects/[id]/payments | 6.9 | 10 | 249 | 10 | 9.5 KB | good |
| `listPhotos` | /dashboard/projects/[id]/obra/fotos | 2.0 | 2 | 53 | 52 | 11 KB | good |
| `listDocuments` | /dashboard/projects/[id]/documents | 1.7 | 2 | 5 | 4 | 1.1 KB | good |

What the numbers mean:

- **Four lists are too long to send whole.** Orders (1.07 MB of JSON), invoices (1.46 MB), payments (0.85 MB)
  and workers (1.71 MB) each sent every row; over HTTP that was 4 to 8 MB of HTML and 1 to 1.9 MB of RSC
  payload per visit, and the browser then filtered 1,200 to 1,650 rows. They grow with every order,
  invoice and payment for ever. *Must fix.*
- **Compras loaded the whole subcontractor network to show a status.** `listPurchases`, `listSuppliers`,
  `getProjectPurchases`, `getPurchase` and the new-order form (`getPurchaseForm`) called `loadNetwork`, which
  reads every worker, every document and two versions of each (27,624 rows), to compute a supplier's CAE
  status, which only takes the company's own documents (a tenth of that). That is most of the 429 ms of
  `listPurchases`, of the 349 ms of `listSuppliers` and of the 256 ms of the order form.
- **`loadNetwork` read each document's last validated version twice over.** The rules only look behind a
  document whose current version is *not* validated (a renewal uploaded early, or rejected): a handful, not
  8,552 rows.
- **The database itself is fast.** The slowest statements execute in 5 to 35 ms; the time goes in moving
  tens of thousands of wide rows into Node and turning them into objects, then into HTML. That is why the
  fixes below load less rather than index more.
- **The counters on every page are cheap**: `getPurchasingCounts` 13 ms in one statement, the subcontractor
  counts 16 ms in three. Both grow with history (see "Left alone").
- **Per-obra pages are fine**, but for the new-order form (256 ms: the network again). Everything else of
  one obra is under 80 ms; `getControl` (27 statements) and `getPurchase` (31) send many small indexed
  statements in parallel.

### Plans: no index is missing

For the big tenant most statements are sequential scans, and that is the right plan: it owns 95 % of every
table, so an index on `tenant_id` would read the same rows more slowly. For the small tenant the same
statements use the indexes there are:

| Statement | Big tenant | Small tenant |
|---|---|---|
| Orders, newest 50 | Seq Scan `purchase_orders` (1,593 rows) + top-N sort, 3.9 ms | Index Scan `purchase_orders_tenant_idx`, 0.6 ms |
| Invoices settled (payments and credit notes aggregated) | Seq Scans + hash joins, 5.5 ms | Bitmap Index Scan `purchase_invoices_tenant_due_idx`, 1.5 ms |
| Workers by surname | Seq Scan `subcontractor_workers` + sort, 3.0 ms | Bitmap Index Scan `subcontractor_workers_tenant_tpc_idx`, 0.2 ms |
| A tenant's documents | Seq Scan `subcontractor_documents` (8,594 rows), 3.6 ms | Index Scan `subcontractor_documents_tenant_idx`, 0.2 ms |
| Each document's latest version | Seq Scan + sort of 9,057 rows, 17 to 34 ms | Index Scan `subcontractor_document_versions_tenant_document_idx`, 0.8 ms |
| An order's history | Bitmap Index Scan `purchase_order_events_order_created_idx`, 0.2 ms | the same |
| Lines of the page's orders | by `order_id`: `purchase_order_lines_order_lineage_unique` | the same |

Two things worth knowing, neither worth a change now:

- The tenant's documents query (`liveDocument`'s `EXISTS`) is planned with a cost so high that Postgres
  turns JIT on for it: 25 ms of compiling for 20 ms of work. It is the planner's estimate that is wrong, not
  the plan.
- "Each document's latest version" sorts every version of the tenant. It is the one statement that an
  index cannot help while the tenant owns the table, and it grows with every renewal (see "Left alone").

**So no index was added, and there is no production SQL file**: nothing measured would be faster with one.

## What changed

1. **Orders, invoices, payments and workers are paged and filtered on the server**, through the whole stack
   (below). For Compras' three lists the filtering, the counts, the totals and the order are SQL; only the
   page's rows are loaded, and shaped by the code that shaped them before, so an item is what it was. The
   workers are still worked out in memory and then cut (see "Left alone").
2. **Compras reads a supplier's status from the company's own documents** (`loadCompanyStatuses` in
   `subcontractor-network.ts`), not from the whole network: `listPurchases` (only the suppliers on the page),
   `listSuppliers`, `getSupplierPurchasing`, `getProjectPurchases`, `getPurchase`, `getPurchaseForm`.
3. **`loadNetwork` reads the last validated version only of documents whose current one isn't validated**:
   8,552 rows fewer on every Subcontratas page, same result (the rules never looked at the others).
4. **The rail's purchasing counters count the invoices and settle only those that could need paying now**
   (an invoice due within the week or past due), set-based, as the lists' `settledInvoices` does it, instead of two
   correlated subqueries per past invoice. Still one statement.
5. **The totals above the lists are computed on the server for the whole set, never from the page shown**:
   in SQL the orders' KPI cards, state counts and "N pedidos · contratado" foot, the invoices' KPI cards and
   state counts and the payments' month total; in core the workers' KPI tiles and access counts.
6. **Not capacity, found on the way:** an order's and a purchase request's history listed the lines an edit
   changed in whatever order the database returned the previous ones (no `ORDER BY`). With statistics on
   those tables (the volume seed's smoke test leaves them) the plan changed and a test of that order failed
   one run in three. The previous lines are now read in budget order (`replaceOrderLines`, `updateRequest`).

### After

Load average 4.63 5.45 4.85; median of 7 runs after a warm-up. "was" is the read the same page made before
(for a paged list, the whole list, which the browser then filtered).

| Read | Page | Time (ms) | was | SQL | DB rows | was | Items | JSON | was | |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|---|
| **Every page** | | | | | | | | | | |
| `getPurchasingCounts` | dashboard layout (rail badges) | 9.8 | 13 | 1 | 1 | 1 |  | 96 B | 96 B | good |
| `subcontractors getCounts` | dashboard layout (rail badges) | 15 | 16 | 3 | 347 | 347 |  | 47 B | 47 B | good |
| **Tenant-wide** | | | | | | | | | | |
| `listProjectsWithBudget (signals)` ¹ | /dashboard/projects | 195 | 469 | 18 | 20,340 | 30,832 | 60 | 44 KB | 44 KB | good |
| `listProjectsWithBudget` ¹ | GET /api/v1/projects (without `?signals=1`) | 13 | 15 | 3 | 114 | 114 | 60 | 33 KB | 33 KB | good |
| `listProjects` | obra pickers | 2.3 | 2.5 | 1 | 60 | 60 | 60 | 29 KB | 29 KB | good |
| `listBudgets` | GET /api/v1/budgets | 79 | 71 | 14 | 10,965 | 10,965 | 60 | 32 KB | 32 KB | good |
| `listPurchases (page 1)` | /dashboard/compras | 32 | 429 | 13 | 690 | 34,877 | 50 | 51 KB | 1071 KB | good |
| `listPurchases (page 1, search + late)` | /dashboard/compras?q=&late=1 | 21 | 429 | 11 | 390 | 34,877 | 29 | 37 KB | 1071 KB | good |
| `listPurchases (by supplier)` | /dashboard/compras?vista=proveedores | 28 | 429 | 14 | 835 | 34,877 | 145 | 88 KB | 1071 KB | good |
| `listPurchases (unpaged)` | GET /api/v1/purchases, CSV export | 126 | 429 | 13 | 11,878 | 34,877 | 1593 | 1083 KB | 1071 KB | **must fix** |
| `listInvoices (page 1)` | /dashboard/compras/facturas | 19 | 63 | 8 | 422 | 4,411 | 50 | 62 KB | 1457 KB | good |
| `listInvoices (page 1, open + search)` | /dashboard/compras/facturas?estado=open&q= | 28 | 63 | 8 | 427 | 4,411 | 50 | 62 KB | 1457 KB | good |
| `listInvoices (unpaged)` | GET /api/v1/purchases/invoices | 83 | 63 | 8 | 6,050 | 4,411 | 1653 | 1468 KB | 1457 KB | **must fix** |
| `listPayments (forecast + page 1)` | /dashboard/compras/pagos | 26 | 77 | 6 | 1,162 | 5,576 | 50 | 258 KB | 852 KB | good |
| `listPayments (unpaged)` | GET /api/v1/purchases/payments | 40 | 77 | 6 | 2,492 | 5,576 | 1380 | 852 KB | 852 KB | **must fix** |
| `listRequests` | /dashboard/compras/solicitudes | 14 | 15 | 4 | 1,086 | 1,086 | 301 | 180 KB | 180 KB | good |
| `listSuppliers` | /dashboard/compras/proveedores | 151 | 349 | 11 | 13,656 | 39,463 | 150 | 48 KB | 48 KB | good |
| `getSupplierPurchasing` | /dashboard/compras/proveedores/[id] | 9.0 | 11 | 12 | 305 | 365 | 36 | 68 KB | 68 KB | good |
| `loadNetwork (whole tenant)` | behind every Subcontratas list | 169 | 231 | 7 | 19,072 | 27,624 | 8594 | 60 B | 60 B | good |
| `subcontractors getOverview` | /dashboard/subcontratas/empresas | 200 | 291 | 8 | 20,032 | 28,584 | 150 | 240 KB | 240 KB | good |
| `listSubcontractors` | GET /api/v1/subcontractors | 142 | 237 | 7 | 19,072 | 27,624 | 150 | 91 KB | 91 KB | good |
| `listWorkersPage (page 1)` | /dashboard/subcontratas/trabajadores | 183 | 256 | 7 | 19,072 | 27,624 | 50 | 72 KB | 1714 KB | good |
| `listWorkersPage (one obra, blocked)` | /dashboard/subcontratas/trabajadores?obra=&acceso=blocked | 151 | 235 | 7 | 19,072 | 27,624 | 11 | 16 KB | 214 KB | good |
| `listWorkers (unpaged)` | GET /api/v1/subcontractors/workers | 164 | 256 | 7 | 19,072 | 27,624 | 1200 | 1714 KB | 1714 KB | **must fix** |
| `listProjectOptions` | /dashboard/subcontratas/trabajadores | 4.8 | 5.7 | 2 | 1,020 | 1,020 | 60 | 78 KB | 78 KB | good |
| `getSubcontractor` | /dashboard/subcontratas/empresas/[id] | 15 | 19 | 10 | 664 | 796 |  | 114 KB | 114 KB | good |
| `getWorker` | /dashboard/subcontratas/trabajadores/[id] | 11 | 14 | 10 | 361 | 493 |  | 12 KB | 12 KB | good |
| **One obra (VOL-002)** | | | | | | | | | | |
| `getProjectPurchaseLines` | /dashboard/projects/[id]/compras | 16 | 24 | 18 | 910 | 910 | 145 | 344 KB | 344 KB | good |
| `getProjectPurchases` | /dashboard/projects/[id]/compras?vista=pedidos | 19 | 66 | 18 | 824 | 4,248 | 52 | 35 KB | 35 KB | good |
| `listRequests (one obra)` | /dashboard/projects/[id]/compras?vista=solicitudes | 3.4 | 4.5 | 3 | 27 | 27 | 6 | 3.9 KB | 3.9 KB | good |
| `getPurchaseForm` | /dashboard/projects/[id]/compras/nuevo | 38 | 256 | 17 | 2,320 | 28,127 | 150 | 79 KB | 79 KB | good |
| `getPurchase` | /dashboard/projects/[id]/compras/[orderId] | 15 | 20 | 28 | 520 | 580 |  | 5.2 KB | 5.2 KB | attention |
| `getInvoice` | /dashboard/compras/facturas/[invoiceId] | 9.8 | 12 | 13 | 172 | 172 |  | 3.3 KB | 3.3 KB | good |
| `getControl` ¹ | /dashboard/projects/[id]/obra | 33 | 54 | 26 | 3,089 | 3,127 | 19 | 25 KB | 25 KB | attention |
| `getControlHeader` | every Obra and Compras page of the obra | 2.5 | 3.4 | 4 | 22 | 22 |  | 1.2 KB | 1.2 KB | good |
| `getCosts` | /dashboard/projects/[id]/obra/costes | 9.1 | 11 | 14 | 503 | 503 | 145 | 71 KB | 71 KB | good |
| `listIssues` | /dashboard/projects/[id]/obra/incidencias | 3.5 | 4.5 | 3 | 13 | 13 | 12 | 4.9 KB | 4.9 KB | good |
| `getPlanning` ¹ | /dashboard/projects/[id]/obra/planificacion | 8.6 | 8.6 | 13 | 295 | 314 |  | 12 KB | 12 KB | good |
| `getBudget` | /dashboard/projects/[id]/budget | 22 | 24 | 9 | 1,141 | 1,141 | 146 | 91 KB | 91 KB | good |
| `listHitos` | /dashboard/projects/[id]/payments | 6.4 | 6.9 | 10 | 249 | 249 | 10 | 9.5 KB | 9.5 KB | good |
| `listPhotos` | /dashboard/projects/[id]/obra/fotos | 1.6 | 2.0 | 2 | 53 | 53 | 52 | 11 KB | 11 KB | good |
| `listDocuments` | /dashboard/projects/[id]/documents | 1.6 | 1.7 | 2 | 5 | 5 | 4 | 1.1 KB | 1.1 KB | good |

¹ Measured later the same day, after the project list gained its signals (next section); "was" is then the
read as the signals were first written. Every other row is the paging work's.

### The project list's signals

The Proyectos list gained, per obra, whether it is on time, how much is built and what needs attention
(`project-signals.ts`). As first written it read 25 statements and 30,832 rows in 469 ms (load average 3.0),
for every caller of `GET /api/v1/projects` too: it loaded every line of every contract (about 8,900 wide rows)
for one % per obra, sent most of the subcontractor network's document ids as bind parameters (about 8,600 in
each of two statements: past Postgres's 65,535 at about ten times the companies, where the list would fail
outright), and read the approved plan twice, the second time after everything else. Now (load average 1.9;
median of 7 after a warm-up):

| Read | Time (ms) | was | SQL | was | DB rows | was |
|---|--:|--:|--:|--:|--:|--:|
| `listProjectsWithBudget(ctx, { signals: true })` (/dashboard/projects) | 195 | 469 | 18 | 25 | 20,340 | 30,832 |
| `listProjectsWithBudget(ctx)` (`GET /api/v1/projects`; `?signals=1` asks for them) | 13 | 469 | 3 | 25 | 114 | 30,832 |
| `getControl` (Obra › Resumen) | 33 | 54 | 26 | 29 | 3,089 | 3,127 |
| `getPlanning` (Obra › Planificación) | 8.6 | 8.6 | 13 | 14 | 295 | 314 |

- **Opt-in.** Only the portal's list asks for the signals; `/api/v1/projects` without `?signals=1` answers as
  before the signals existed (they are absent, not null).
- **No lines.** `loadObraSummaries` (`obra-data.ts`) sums each contract chapter's lines in SQL, priced as the
  Budget prices them (`linePriceSql`) and rounded per line as `progressOf` rounds them (`LineTotals`), so the
  same pure `progressOfTotals` gives `loadObra`'s figure; a chapter finished on Avance counts in full, as there.
  960 rows instead of about 8,900; no hito checks or acta photos. Tests compare it with `loadObra` (options
  chosen, a deduction on a negative half cent, a chapter finished with lines under 100 %), and on this dataset
  every one of the 64 obras' schedule, built %, CAE warnings, late deliveries and hitos to invoice equals what
  its Obra tab says.
- **No list of ids.** The network's documents and their versions are now selected by subquery
  (`loadNetwork`, `loadCompanyStatuses`), never by a list of document ids, so no read has a bind parameter per
  document; the versions go out with the documents instead of after them. The list's CAE count
  (`countProjectsAttention`) loads no workers and counts per company once, not per obra.
- **`liveDocument` without JIT.** The documents' "an obra's document only while the company is on it" was a
  correlated `exists` under an `or`, estimated so high that Postgres compiled it (JIT): 51 ms for the tenant's
  8,594 documents. As an `in` over the live assignments it executes in 4 ms, same rows. Every Subcontratas read
  gains: `loadNetwork (whole tenant)` 127 ms (192 just before), `getOverview` 161 (227), `listSuppliers` 133 (189).
- **The plan read once.** `approvedPlansOf` (`planning-data.ts`) reads the approved version and its items in
  one statement, alongside the obra; the schedule (`obraSchedule`, now synchronous) and Planificación use it, so
  Resumen loses two serial round trips and Planificación one statement. `contractSchedule` runs once per obra.
- Late deliveries are counted per obra in SQL, open material orders only.
- What is left: the list still reads the assigned companies' documents and their latest versions (about
  15,400 of its 20,340 rows): the CAE rules are TypeScript, so counting warnings needs every document's state.
  The fix is the stored status of "Left alone". `loadCompanyStatuses` now always sends its two version reads
  (in parallel with the rest), so `getPurchase` is at 30 statements (28) and `getSupplierPurchasing` at 14 (12),
  with no more time.

### Over HTTP

Before: load average 4.60 4.27 3.89. After: 4.04 3.49 3.63. Median of 5 runs after a warm-up; sizes uncompressed unless said.

| Page | TTFB before | after | HTML or JSON before | after | gzipped before | after | RSC before | after |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| `/dashboard/projects` | 73 ms | 73 ms | 506 KB | 507 KB | 61 KB | 61 KB | 157 KB | 158 KB |
| `/dashboard/compras` | 880 ms | 68 ms | 7,700 KB | 453 KB | 579 KB | 79 KB | 1,206 KB | 186 KB |
| `/dashboard/compras/facturas` | 284 ms | 50 ms | 5,274 KB | 369 KB | 472 KB | 75 KB | 1,592 KB | 198 KB |
| `/dashboard/compras/pagos` | 253 ms | 62 ms | 4,250 KB | 674 KB | 311 KB | 109 KB | 987 KB | 393 KB |
| `/dashboard/compras/solicitudes` | 133 ms | 120 ms | 1,502 KB | 1,502 KB | 143 KB | 143 KB | 315 KB | 315 KB |
| `/dashboard/compras/proveedores` | 435 ms | 256 ms | 618 KB | 618 KB | 76 KB | 76 KB | 184 KB | 184 KB |
| `/dashboard/compras/proveedores/[id]` | 60 ms | 66 ms | 486 KB | 487 KB | 71 KB | 71 KB | 203 KB | 204 KB |
| `/dashboard/subcontratas/empresas` | 370 ms | 323 ms | 1,623 KB | 1,623 KB | 102 KB | 102 KB | 363 KB | 364 KB |
| `/dashboard/subcontratas/empresas/[id]` | 70 ms | 65 ms | 450 KB | 450 KB | 67 KB | 67 KB | 321 KB | 321 KB |
| `/dashboard/subcontratas/trabajadores` | 544 ms | 268 ms | 7,604 KB | 608 KB | 281 KB | 73 KB | 1,930 KB | 288 KB |
| `/dashboard/subcontratas/trabajadores?obra=[id]` | 296 ms | 233 ms | 1,210 KB | 608 KB | 91 KB | 73 KB | 430 KB | 289 KB |
| `/dashboard/projects/[id]` | 45 ms | 65 ms | 193 KB | 193 KB | 51 KB | 51 KB | 151 KB | 151 KB |
| `/dashboard/projects/[id]/compras` | 92 ms | 92 ms | 765 KB | 765 KB | 105 KB | 105 KB | 371 KB | 372 KB |
| `/dashboard/projects/[id]/compras?vista=pedidos` | 113 ms | 75 ms | 428 KB | 429 KB | 75 KB | 75 KB | 187 KB | 187 KB |
| `/dashboard/projects/[id]/compras/nuevo` | 286 ms | 93 ms | 517 KB | 517 KB | 76 KB | 77 KB | 216 KB | 216 KB |
| `/dashboard/projects/[id]/obra` | 115 ms | 98 ms | 278 KB | 278 KB | 58 KB | 58 KB | 162 KB | 162 KB |
| `/dashboard/projects/[id]/obra/costes` | 56 ms | 67 ms | 280 KB | 280 KB | 67 KB | 67 KB | 209 KB | 209 KB |
| `/dashboard/projects/[id]/obra/planificacion` | 63 ms | 67 ms | 307 KB | 307 KB | 55 KB | 55 KB | 150 KB | 150 KB |
| `/dashboard/projects/[id]/budget` | 70 ms | 63 ms | 302 KB | 302 KB | 79 KB | 79 KB | 226 KB | 226 KB |
| `/api/v1/budgets` | 86 ms | 95 ms | 32 KB | 32 KB | 32 KB | 32 KB |  |  |
| `/api/v1/purchases` | 478 ms | 155 ms | 1,071 KB | 1,083 KB | 1,071 KB | 1,083 KB |  |  |
| `/api/v1/purchases/invoices` | 78 ms | 99 ms | 1,457 KB | 1,468 KB | 1,457 KB | 1,468 KB |  |  |
| `/api/v1/purchases/payments` | 88 ms | 57 ms | 852 KB | 852 KB | 852 KB | 852 KB |  |  |
| `/api/v1/subcontractors/workers` | 301 ms | 226 ms | 1,714 KB | 1,714 KB | 1,714 KB | 1,714 KB |  |  |
| `/api/v1/purchases/counts` | 21 ms | 19 ms | 96 B | 96 B | 96 B | 96 B |  |  |
| `/dashboard/compras?page=3&estado=done` | | 76 ms | | 452 KB | | 78 KB | | 188 KB |
| `/dashboard/compras?vista=proveedores` | | 67 ms | | 458 KB | | 80 KB | | 224 KB |
| `/dashboard/compras/facturas?estado=open&q=f26` | | 60 ms | | 369 KB | | 75 KB | | 198 KB |
| `/dashboard/subcontratas/trabajadores?acceso=blocked` | | 267 ms | | 613 KB | | 73 KB | | 290 KB |
| `/api/v1/purchases?page=1` | | 36 ms | | 51 KB | | 51 KB | |  |
| `/api/v1/purchases/invoices?page=1` | | 27 ms | | 62 KB | | 62 KB | |  |
| `/api/v1/purchases/payments?page=1` | | 38 ms | | 258 KB | | 258 KB | |  |
| `/api/v1/subcontractors/workers?page=1` | | 252 ms | | 72 KB | | 72 KB | |  |

After the change no page sends over 500 KB of RSC payload nor takes a second. Three stay near the 300 ms
line over HTTP, all of them Subcontratas' network or Proveedores' sums (see "Left alone"): Empresas (323 ms,
was 370), Trabajadores (268 ms, was 544) and Proveedores (256 ms, was 435).

The HTML of every page carries about 190 KB before any data: the portal's translations (`es.json`, 161 KB)
are sent whole with each page (see "Left alone"). `next start` does not compress the JSON of `/api/v1`
(Vercel does), hence the equal columns there.

## How the paged lists work

- **Core** takes `{ page, limit }` (page from 1; 50 rows by default, 200 at most: a larger limit is cut, not
  refused) and the list's filters, and returns the page with `paging: { page, limit, total, pages }`
  (`packages/core/src/paging.ts`). A page past the end is empty, with the pages there are. A page or limit
  that is not a whole number from 1 is `invalid_page` (400).
  - `purchasingService.listPurchases(ctx, { page, limit, group, projectId, supplierId, kind, from, to, late, q, by })`:
    also `groupCounts` (each state's count for the other filters), `shownContractedCents`, `suppliers` (the
    filter's options) and, with `by: "supplier"`, `bySupplier`. The summary is the whole tenant's.
  - `purchaseInvoicesService.listInvoices(ctx, scope, { page, limit, group, projectId, supplierId, q })`: also
    `groupCounts` and `suppliers`. `scope` (`projectId`, `subcontractorId`, as before) narrows the summary too;
    the list's own filters never do, so the KPI cards stay the company's while the list is filtered.
  - `purchaseInvoicesService.listPayments(ctx, scope, { page, limit })`: the forecast is whole on every page
    (only the invoices that owe something are loaded for it); the payments are the page.
  - `subcontractorWorkersService.listWorkersPage(ctx, { page, limit, projectId, companyId, access, q })`:
    `{ workers, paging, counts, summary }`.
- **Server actions** pass the query through: `getPurchases(query)`, `exportPurchases(filters)`,
  `getInvoices(query)`, `getPayments(query)`, `getWorkersPage(query)`.
- **`/api/v1` stays backwards compatible.** Without `?page` or `?limit` a route answers as it always did:
  every row, the same fields (the new ones, `paging` and the counts, are added beside them), now capped at
  5,000 rows, with `paging.total` saying how many there are. With `?page=` / `?limit=` it answers one page.
  - `GET /api/v1/purchases` `?page&limit&group&projectId&supplierId&kind&from&to&late=1&q&by=supplier`
  - `GET /api/v1/purchases/invoices` `?projectId&subcontractorId` (as before) `&page&limit&group&q`
  - `GET /api/v1/purchases/payments` `?projectId&subcontractorId` (as before) `&page&limit`
  - `GET /api/v1/subcontractors/workers`: without paging parameters still the array of every worker; with
    `?page` or `?limit` (and `?access&companyId&q&projectId`) the `WorkersPage` object. An array cannot carry
    a total, hence the object only when a page is asked for.

  Nothing in the repository calls these four routes (the mobile app only uses `/api/mobile`), so the only
  consumer that could notice is an external one reading more than 5,000 rows, whose response would already
  be over Vercel's 4.5 MB limit.
- **The portal** keeps each list's filters in the URL and the server applies them:
  - `/dashboard/compras?vista=proveedores&estado=&obra=&proveedor=&tipo=&desde=&hasta=&retraso=1&q=&page=`
  - `/dashboard/compras/facturas?estado=&obra=&proveedor=&q=&page=`
  - `/dashboard/compras/pagos?page=`
  - `/dashboard/subcontratas/trabajadores?obra=&acceso=&empresa=&q=&page=`

  Changing a filter replaces the URL and goes back to the first page; the search box waits 300 ms after the
  last key. A mistyped `?page=` is the first page. The pager (`components/ui/pager.tsx`) shows "51–100 de
  1.593", "Página 2 de 32" and links to the page before and after. The CSV export of Compras asks the server
  for every order the filters keep, not the page shown.

## Left alone, and why

| What | Number | Why not now | The fix when it is needed |
|---|---|---|---|
| The workers list still builds every worker before cutting the page | 183 ms in core (was 256), 268 ms over HTTP (was 544), 19,072 rows | A worker's access is computed from the documents by six rules in TypeScript, never stored: filtering by it in SQL means rewriting the rules in SQL or storing their result. Paging fixed what was broken (1.7 MB sent); the time is under the budget. | Store each worker's access (and each company's status) when a document changes, then filter and page in SQL. |
| Subcontratas › Empresas (`getOverview`) | 200 ms in core (was 291), 323 ms over HTTP (was 370): at the "attention" line; 240 KB, 1.6 MB of HTML (102 KB gzipped) | Needs the whole network for its KPIs and attention list; 150 companies is not a long list. Fix 3 took a quarter off; the rest is the network itself. | The same stored status; then page the attention list. |
| "Each document's latest version" sorts every version of the tenant | 17 to 34 ms, on every Subcontratas page and in the rail's counter | Grows with every renewal (monthly certificates above all); fine at 9,000 versions. | A `current_version_id` on `subcontractor_documents`, set on upload. |
| The rail's counters | 10 ms + 15 ms on every page | Both good, 1 and 3 statements. They read all history: every invoice ever, every version ever. No cache was added, as asked. | The invoices' counter needs a stored "settled" mark on the invoice; the documents' one the `current_version_id` above. Worth it around 100,000 invoices or versions. |
| Solicitudes (purchase requests), not paged | 14 ms, 301 rows, 180 KB of JSON, 315 KB of RSC, 1.5 MB of HTML (143 KB gzipped) | Under every budget; about 7 requests per obra. | The same paging as the orders; the list already orders by state in memory (`RANK`), which moves to SQL. |
| Proveedores (`listSuppliers`) | 151 ms in core (was 349), 256 ms over HTTP (was 435), 13,656 rows | Still loads every order and invoice to add up 150 suppliers in TypeScript. Under the budget. | The sums per supplier in SQL (as `bySupplier` now does for orders). |
| The budgets overview (`listBudgets`, `GET /api/v1/budgets`) | 79 ms, 14 statements | One statement per draft revision for its review checks (9 drafts here): an N+1 that grows with the drafts open, not with history. | Load the drafts' chapters in one statement for `revisionChecks`. |
| `getControl` (26 statements) and `getPurchase` (30) | 33 ms and 15 ms | Many small indexed statements sent in parallel; over the "about 25" line by two or three. | Fold `loadObra`'s five hito reads into one. |
| The unpaged API answers (`/api/v1/purchases`, `…/invoices`, `…/payments`, `…/workers` without `?page`) | 0.85 to 1.7 MB, 40 to 164 ms in core | Kept for compatibility, capped at 5,000 rows. `…/invoices` unpaged is slower than before (83 ms, was 63): it now also counts in SQL. | Make `?page` mandatory once no client asks without it. |
| Pagos' forecast lists every invoice owed | 258 KB of JSON, 393 KB of RSC | It is what the page shows (268 of the 315 invoices owed here fall in its weeks); it grows with what is owed, not with history. | Show each week's total and open its invoices on demand. |
| Every page's HTML starts at 190 KB | `es.json` is 161 KB | Not a list; gzipped it is 41 KB. Out of scope here. | Give each route only the namespaces it uses (`NextIntlClientProvider` with picked messages). |
| `inArray(ids)` with one parameter per id | up to 5,000 ids on an unpaged call; one per live obra in the project list's signals | Postgres takes 65,534 parameters; the cap keeps a call well under. Document ids are never sent as a list (subqueries). | Nothing while lists are paged. |

One web test (`OrderScreen.test.tsx`, "adds a document…") failed once in a run on the loaded machine and
passed alone; it does not touch what changed here.

## Repeating it

```bash
# A scratch database on the local Postgres (never `vitah`), with the schema
docker compose exec postgres createdb -U vitah vitah_volume
export POSTGRES_URL=postgres://vitah:vitah_dev@localhost:4432/vitah_volume
pnpm db:push
pnpm db:seed:volume            # about a minute
pnpm db:bench                  # BENCH_RUNS=7 by default; BENCH_OUT=file.json keeps the numbers
# Over HTTP (never port 3000)
cd apps/web && NEXTAUTH_SECRET=local AUTH_TRUST_HOST=true npx next build
NEXTAUTH_SECRET=local AUTH_TRUST_HOST=true AUTH_URL=http://localhost:3210 npx next start --port 3210 &
node ../../doc/ops/capacity-http.mjs http://localhost:3210 5
# Afterwards: stop the server, and
docker compose exec postgres dropdb -U vitah vitah_volume
```
