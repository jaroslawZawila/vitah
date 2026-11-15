// `pnpm db:bench`: times the reads the portal performs, against the volume
// dataset (./volume, `pnpm db:seed:volume`), as the big tenant's admin. For
// each read: the server time (median of BENCH_RUNS runs after a warm-up, 7 by
// default), the SQL statements it sends, the rows the database returns to it,
// the items of its main list and the size of its result as JSON (what a
// /api/v1 route would send, and about what a page's RSC payload carries).
// Prints a Markdown table; BENCH_OUT=<file> also writes the numbers as JSON.
// Results and what they mean: doc/ops/capacity.md.

import { writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { and, db, desc, eq, projects, purchaseInvoices, purchaseOrders, sql, subcontractorWorkers, subcontractors, tenants, users } from "@repo/db";
import {
  budgetOverviewService,
  budgetService,
  constructionService,
  documentsService,
  hitosService,
  photosService,
  planningService,
  projectsService,
  purchaseInvoicesService,
  purchaseRequestsService,
  purchaseSuppliersService,
  purchasingService,
  subcontractorsService,
  subcontractorWorkersService,
  type Ctx,
} from "../index";
import { loadNetwork } from "../subcontractor-network";
import { assertVolumeTarget, VOLUME_ADMIN_EMAIL, VOLUME_SLUGS } from "./volume";

// ─── Counting what a read sends ──────────────────────────────────────────────

const sent = { statements: 0, rows: 0 };

type Query = { then: (onFulfilled?: unknown, onRejected?: unknown) => unknown };
type Client = { unsafe: (...args: unknown[]) => Query; begin: (...args: unknown[]) => unknown };

/** Counts every statement Drizzle sends through this postgres.js client, and the rows that come back. */
function count(client: Client) {
  const unsafe = client.unsafe.bind(client);
  client.unsafe = (...args: unknown[]) => {
    sent.statements++;
    const query = unsafe(...args);
    const then = query.then.bind(query);
    // A query runs when it is awaited: the rows are counted as they arrive.
    query.then = (onFulfilled?: unknown, onRejected?: unknown) =>
      then((result: unknown) => {
        if (Array.isArray(result)) sent.rows += result.length;
        return typeof onFulfilled === "function" ? (onFulfilled as (r: unknown) => unknown)(result) : result;
      }, onRejected);
    return query;
  };
  const begin = client.begin.bind(client);
  // A transaction runs on a client of its own.
  client.begin = (...args: unknown[]) => {
    const work = args.at(-1) as (tx: Client) => unknown;
    return begin(...args.slice(0, -1), (tx: Client) => {
      count(tx);
      return work(tx);
    });
  };
}

// ─── Measuring ───────────────────────────────────────────────────────────────

type Measured = {
  group: string;
  name: string;
  /** The portal page (or API route) that performs it. */
  page: string;
  ms: number;
  minMs: number;
  maxMs: number;
  statements: number;
  dbRows: number;
  items: number | null;
  bytes: number;
};

const RUNS = Math.max(1, Number(process.env.BENCH_RUNS ?? 7));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

async function measure<T>(
  group: string,
  name: string,
  page: string,
  read: () => Promise<T>,
  items: (result: T) => number | null = () => null,
): Promise<Measured> {
  await read();
  const times: number[] = [];
  let result!: T;
  for (let run = 0; run < RUNS; run++) {
    sent.statements = 0;
    sent.rows = 0;
    const startedAt = performance.now();
    result = await read();
    times.push(performance.now() - startedAt);
  }
  return {
    group,
    name,
    page,
    ms: median(times),
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
    statements: sent.statements,
    dbRows: sent.rows,
    items: items(result),
    bytes: Buffer.byteLength(JSON.stringify(result) ?? ""),
  };
}

const kb = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`);
const ms = (value: number) => (value < 10 ? value.toFixed(1) : String(Math.round(value)));

/** Good under 300 ms, 25 statements and 500 KB; a second or 500 KB is too much. */
function verdict(m: Measured) {
  if (m.ms > 1000 || m.bytes > 500 * 1024) return "must fix";
  if (m.ms >= 300 || m.statements > 25) return "attention";
  return "good";
}

// ─── The reads ───────────────────────────────────────────────────────────────

async function run() {
  assertVolumeTarget(process.env.POSTGRES_URL);
  count((db as unknown as { $client: Client }).$client);

  const [admin] = await db
    .select({ id: users.id, tenantId: users.tenantId })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(eq(tenants.slug, VOLUME_SLUGS.big), eq(users.email, VOLUME_ADMIN_EMAIL)));
  if (!admin) throw new Error("No volume dataset here: run `pnpm db:seed:volume` first");
  const ctx: Ctx = { tenantId: admin.tenantId, userId: admin.id, role: "admin" };
  const inTenant = sql`tenant_id = ${ctx.tenantId}`;

  // The busiest obra, supplier, company, order and invoice: the worst case of each page.
  const [project] = await db
    .select({ id: projects.id, ref: projects.ref })
    .from(projects)
    .where(eq(projects.tenantId, ctx.tenantId))
    .orderBy(desc(sql`(select count(*) from ${purchaseOrders} o where o.project_id = ${projects.id})`), projects.ref)
    .limit(1);
  const [supplier] = await db
    .select({ id: subcontractors.id })
    .from(subcontractors)
    .where(eq(subcontractors.tenantId, ctx.tenantId))
    .orderBy(desc(sql`(select count(*) from ${purchaseOrders} o where o.subcontractor_id = ${subcontractors.id})`), subcontractors.legalName)
    .limit(1);
  const [company] = await db
    .select({ id: subcontractors.id })
    .from(subcontractors)
    .where(eq(subcontractors.tenantId, ctx.tenantId))
    .orderBy(desc(sql`(select count(*) from ${subcontractorWorkers} w where w.subcontractor_id = ${subcontractors.id})`), subcontractors.legalName)
    .limit(1);
  const [worker] = await db
    .select({ id: subcontractorWorkers.id })
    .from(subcontractorWorkers)
    .where(eq(subcontractorWorkers.subcontractorId, company!.id))
    .orderBy(subcontractorWorkers.idDocument)
    .limit(1);
  const [invoice] = await db
    .select({ id: purchaseInvoices.id, orderId: purchaseInvoices.orderId })
    .from(purchaseInvoices)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseInvoices.orderId))
    .where(and(eq(purchaseOrders.projectId, project!.id), eq(purchaseInvoices.kind, "invoice")))
    .orderBy(desc(purchaseInvoices.baseCents), purchaseInvoices.number)
    .limit(1);
  if (!project || !supplier || !company || !worker || !invoice) throw new Error("The volume dataset is incomplete");
  const p = project.id;

  const sizes = await db.execute<{ name: string; rows: number }>(sql`
    select 'projects' as name, count(*)::int as rows from projects where ${inTenant}
    union all select 'budget_lines', count(*)::int from budget_lines where ${inTenant}
    union all select 'purchase_orders', count(*)::int from purchase_orders where ${inTenant}
    union all select 'purchase_order_lines', count(*)::int from purchase_order_lines where ${inTenant}
    union all select 'purchase_order_events', count(*)::int from purchase_order_events where ${inTenant}
    union all select 'purchase_invoices', count(*)::int from purchase_invoices where ${inTenant}
    union all select 'purchase_payments', count(*)::int from purchase_payments where ${inTenant}
    union all select 'purchase_requests', count(*)::int from purchase_requests where ${inTenant}
    union all select 'subcontractors', count(*)::int from subcontractors where ${inTenant}
    union all select 'subcontractor_workers', count(*)::int from subcontractor_workers where ${inTenant}
    union all select 'subcontractor_documents', count(*)::int from subcontractor_documents where ${inTenant}
    union all select 'subcontractor_document_versions', count(*)::int from subcontractor_document_versions where ${inTenant}
    union all select 'subcontractor_audit', count(*)::int from subcontractor_audit where ${inTenant}
    union all select 'subcontractor_assignments', count(*)::int from subcontractor_assignments where ${inTenant}
    union all select 'obra_issues', count(*)::int from obra_issues where ${inTenant}
    union all select 'project_photos', count(*)::int from project_photos where ${inTenant}`);
  const [{ size } = { size: "?" }] = await db.execute<{ size: string }>(sql`select pg_size_pretty(pg_database_size(current_database())) as size`);

  const all = "Every page";
  const company_ = "Tenant-wide";
  const obra = `One obra (${project.ref})`;
  const list = <T>(pick: (result: T) => unknown[]) => (result: T) => pick(result).length;
  const results: Measured[] = [];
  const add = async <T>(...args: Parameters<typeof measure<T>>) => results.push(await measure<T>(...args));

  await add(all, "getPurchasingCounts", "dashboard layout (rail badges)", () => purchaseInvoicesService.getPurchasingCounts(ctx));
  await add(all, "subcontractors getCounts", "dashboard layout (rail badges)", () => subcontractorsService.getCounts(ctx));

  await add(company_, "listProjectsWithBudget (signals)", "/dashboard/projects", () => budgetOverviewService.listProjectsWithBudget(ctx, { signals: true }), list((r) => r));
  await add(company_, "listProjectsWithBudget", "GET /api/v1/projects", () => budgetOverviewService.listProjectsWithBudget(ctx), list((r) => r));
  await add(company_, "listProjects", "obra pickers", () => projectsService.listProjects(ctx), list((r) => r));
  await add(company_, "listBudgets", "GET /api/v1/budgets", () => budgetOverviewService.listBudgets(ctx), list((r) => r.items));
  // The portal's lists ask for their first page; an API client that asks for none still gets everything.
  const first = { page: 1 };
  await add(company_, "listPurchases (page 1)", "/dashboard/compras", () => purchasingService.listPurchases(ctx, first), list((r) => r.orders));
  await add(company_, "listPurchases (page 1, search + late)", "/dashboard/compras?q=&late=1", () => purchasingService.listPurchases(ctx, { ...first, q: "suministro", late: "1" }), list((r) => r.orders));
  await add(company_, "listPurchases (by supplier)", "/dashboard/compras?vista=proveedores", () => purchasingService.listPurchases(ctx, { ...first, by: "supplier" }), list((r) => r.bySupplier ?? []));
  await add(company_, "listPurchases (unpaged)", "GET /api/v1/purchases, CSV export", () => purchasingService.listPurchases(ctx), list((r) => r.orders));
  await add(company_, "listInvoices (page 1)", "/dashboard/compras/facturas", () => purchaseInvoicesService.listInvoices(ctx, {}, first), list((r) => r.invoices));
  await add(company_, "listInvoices (page 1, open + search)", "/dashboard/compras/facturas?estado=open&q=", () => purchaseInvoicesService.listInvoices(ctx, {}, { ...first, group: "open", q: "f26" }), list((r) => r.invoices));
  await add(company_, "listInvoices (unpaged)", "GET /api/v1/purchases/invoices", () => purchaseInvoicesService.listInvoices(ctx), list((r) => r.invoices));
  await add(company_, "listPayments (forecast + page 1)", "/dashboard/compras/pagos", () => purchaseInvoicesService.listPayments(ctx, {}, first), list((r) => r.payments));
  await add(company_, "listPayments (unpaged)", "GET /api/v1/purchases/payments", () => purchaseInvoicesService.listPayments(ctx), list((r) => r.payments));
  await add(company_, "listRequests", "/dashboard/compras/solicitudes", () => purchaseRequestsService.listRequests(ctx), list((r) => r.requests));
  await add(company_, "listSuppliers", "/dashboard/compras/proveedores", () => purchaseSuppliersService.listSuppliers(ctx), list((r) => r.suppliers));
  await add(company_, "getSupplierPurchasing", "/dashboard/compras/proveedores/[id]", () => purchaseSuppliersService.getSupplierPurchasing(ctx, supplier.id), list((r) => r.orders));
  await add(company_, "loadNetwork (whole tenant)", "behind every Subcontratas list", async () => {
    const net = await loadNetwork(ctx.tenantId);
    return { companies: net.companies.length, workers: net.workers.length, docs: net.docs.length, versions: net.versions.size };
  }, (r) => r.docs);
  await add(company_, "subcontractors getOverview", "/dashboard/subcontratas/empresas", () => subcontractorsService.getOverview(ctx), list((r) => r.companies));
  await add(company_, "listSubcontractors", "GET /api/v1/subcontractors", () => subcontractorsService.listSubcontractors(ctx), list((r) => r));
  await add(company_, "listWorkersPage (page 1)", "/dashboard/subcontratas/trabajadores", () => subcontractorWorkersService.listWorkersPage(ctx, first), list((r) => r.workers));
  await add(company_, "listWorkersPage (one obra, blocked)", "/dashboard/subcontratas/trabajadores?obra=&acceso=blocked", () => subcontractorWorkersService.listWorkersPage(ctx, { ...first, projectId: p, access: "blocked" }), list((r) => r.workers));
  await add(company_, "listWorkers (unpaged)", "GET /api/v1/subcontractors/workers", () => subcontractorWorkersService.listWorkers(ctx), list((r) => r));
  await add(company_, "listProjectOptions", "/dashboard/subcontratas/trabajadores", () => subcontractorsService.listProjectOptions(ctx), list((r) => r));
  await add(company_, "getSubcontractor", "/dashboard/subcontratas/empresas/[id]", () => subcontractorsService.getSubcontractor(ctx, company.id));
  await add(company_, "getWorker", "/dashboard/subcontratas/trabajadores/[id]", () => subcontractorWorkersService.getWorker(ctx, worker.id));

  await add(obra, "getProjectPurchaseLines", "/dashboard/projects/[id]/compras", () => purchasingService.getProjectPurchaseLines(ctx, p), list((r) => r.chapters.flatMap((c) => c.lines)));
  await add(obra, "getProjectPurchases", "/dashboard/projects/[id]/compras?vista=pedidos", () => purchasingService.getProjectPurchases(ctx, p), list((r) => r.orders));
  await add(obra, "listRequests (one obra)", "/dashboard/projects/[id]/compras?vista=solicitudes", () => purchaseRequestsService.listRequests(ctx, { projectId: p }), list((r) => r.requests));
  await add(obra, "getPurchaseForm", "/dashboard/projects/[id]/compras/nuevo", () => purchasingService.getPurchaseForm(ctx, p), list((r) => r.suppliers));
  await add(obra, "getPurchase", "/dashboard/projects/[id]/compras/[orderId]", () => purchasingService.getPurchase(ctx, invoice.orderId));
  await add(obra, "getInvoice", "/dashboard/compras/facturas/[invoiceId]", () => purchaseInvoicesService.getInvoice(ctx, invoice.id));
  await add(obra, "getControl", "/dashboard/projects/[id]/obra", () => constructionService.getControl(ctx, p), list((r) => r.chapters));
  await add(obra, "getControlHeader", "every Obra and Compras page of the obra", () => constructionService.getControlHeader(ctx, p));
  await add(obra, "getCosts", "/dashboard/projects/[id]/obra/costes", () => constructionService.getCosts(ctx, p), list((r) => r.chapters.flatMap((c) => c.lines)));
  await add(obra, "listIssues", "/dashboard/projects/[id]/obra/incidencias", () => constructionService.listIssues(ctx, p), list((r) => r));
  await add(obra, "getPlanning", "/dashboard/projects/[id]/obra/planificacion", () => planningService.getPlanning(ctx, p));
  await add(obra, "getBudget", "/dashboard/projects/[id]/budget", () => budgetService.getBudget(ctx, p), (r) => r.revision?.chapters.flatMap((c) => c.lines).length ?? null);
  await add(obra, "listHitos", "/dashboard/projects/[id]/payments", () => hitosService.listHitos(ctx, p), list((r) => r));
  await add(obra, "listPhotos", "/dashboard/projects/[id]/obra/fotos", () => photosService.listPhotos(ctx, p), list((r) => r));
  await add(obra, "listDocuments", "/dashboard/projects/[id]/documents", () => documentsService.listDocuments(ctx, p), list((r) => r));

  const load = loadavg().map((v) => v.toFixed(2)).join(" ");
  const lines = [
    `Database ${new URL(process.env.POSTGRES_URL!).pathname.slice(1)} (${size}); median of ${RUNS} runs after a warm-up; load average ${load}.`,
    "",
    `Rows of the big tenant: ${sizes.map((s) => `${s.name} ${s.rows.toLocaleString("en")}`).join(", ")}.`,
    "",
    "| Read | Page | Time (ms) | min–max | SQL | DB rows | Items | JSON | |",
    "|---|---|--:|--:|--:|--:|--:|--:|---|",
  ];
  let group = "";
  for (const m of results) {
    if (m.group !== group) lines.push(`| **${(group = m.group)}** | | | | | | | | |`);
    lines.push(
      `| \`${m.name}\` | ${m.page} | ${ms(m.ms)} | ${ms(m.minMs)}–${ms(m.maxMs)} | ${m.statements} | ${m.dbRows.toLocaleString("en")} | ${m.items ?? ""} | ${kb(m.bytes)} | ${verdict(m)} |`,
    );
  }
  console.log(lines.join("\n"));
  if (process.env.BENCH_OUT) {
    writeFileSync(process.env.BENCH_OUT, JSON.stringify({ at: new Date().toISOString(), runs: RUNS, load, size, sizes, results }, null, 2));
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
