// Guards soft deletion (CLAUDE.md › Database, "Deletes are soft"): no production read of a soft-deleted table may
// show its deleted rows, nor, for a table under a project, a deleted project's rows. The analyser and its rules are
// in ./soft-delete-guard.ts. A read that must see deleted rows names its tables and says why, next to it:
// `// soft-delete-ok(projectDocuments): <reason>`.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze, readSchema, type Report } from "./soft-delete-guard";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
// The schema is its entry and its modules (packages/db/src/schema/), read as one text.
const schemaDir = join(repo, "packages/db/src/schema");
const schemaFiles = [join(repo, "packages/db/src/schema.ts"), ...readdirSync(schemaDir).filter((f) => f.endsWith(".ts")).map((f) => join(schemaDir, f))];
const schema = readSchema(schemaFiles.map((f) => readFileSync(f, "utf8")).join("\n"));

/** Production sources: no tests, no declaration files, no build output. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return ["node_modules", "test", "__tests__"].includes(e.name) || e.name.startsWith(".") ? [] : sources(path);
    return /\.tsx?$/.test(e.name) && !/\.(test|d)\.tsx?$/.test(e.name) ? [path] : [];
  });
}

// Core holds every query; the portal, auth and the database package are scanned too, in case one creeps in there.
const roots = ["packages/core/src", "packages/auth/src", "packages/db/src", "apps/web"];
const files = roots.flatMap((d) => sources(join(repo, d))).filter((f) => !schemaFiles.includes(f));
const report = analyze(
  files.map((path) => ({ path, text: readFileSync(path, "utf8") })),
  schema,
);
const where = (p: { file: string; line: number }) => `${relative(repo, p.file)}:${p.line}`;

describe("soft deletion in the codebase", () => {
  it("knows the soft-deleted tables, and what lies under a project, from the schema", () => {
    expect([...schema.soft].sort()).toEqual(
      [
        "budgetExclusionPresets",
        "obraIssueFiles",
        "projectDocuments",
        "projectPhotos",
        "projects",
        "purchaseInvoices",
        "purchaseOrderDocuments",
        "purchasePayments",
        "subcontractorAssignments",
      ].sort(),
    );
    // Under a project through its keys: a document version through its document, its order, its project.
    expect(schema.tables.get("purchaseOrderDocumentVersions")).toMatchObject({ underProject: true });
    expect([...schema.tables.get("purchaseOrderDocumentVersions")!.scoping]).toEqual(expect.arrayContaining(["id", "documentId"]));
    // A company works on many obras: its key narrows nothing.
    expect(schema.tables.get("subcontractors")).toMatchObject({ underProject: false });
    expect(schema.tables.get("subcontractorAssignments")!.scoping.has("subcontractorId")).toBe(false);
  });

  // Pinned, so a new way of declaring a key fails here instead of silently emptying what the guard checks.
  it("finds every table under a project, and the columns that narrow each soft-deleted one", () => {
    const under = [...schema.tables.values()].filter((t) => t.underProject).map((t) => t.name);
    expect(under.sort()).toEqual(
      [
        "aiUsage",
        "budgetApprovals",
        "budgetChapters",
        "budgetGenerations",
        "budgetLines",
        "budgetRevisionChanges",
        "budgetRevisions",
        "obraChapterProgress",
        "obraHitoChapters",
        "obraHitoChecks",
        "obraHitoEvents",
        "obraHitoPhotos",
        "obraHitos",
        "obraInvoiceRequests",
        "obraIssueFiles",
        "obraIssues",
        "obraProgressEvents",
        "planningItems",
        "planningVersions",
        "projectDocuments",
        "projectPhotos",
        "projects",
        "purchaseDocumentChecks",
        "purchaseInvoiceFiles",
        "purchaseInvoiceLines",
        "purchaseInvoices",
        "purchaseOrderAmendments",
        "purchaseOrderDocumentVersions",
        "purchaseOrderDocuments",
        "purchaseOrderEvents",
        "purchaseOrderLines",
        "purchaseOrderMilestones",
        "purchaseOrders",
        "purchasePayments",
        "purchaseRequestEvents",
        "purchaseRequestLines",
        "purchaseRequests",
        "subcontractorAssignments",
        "subcontractorDocumentVersions",
        "subcontractorDocuments",
        "warrantyClaimEvents",
        "warrantyClaimPhotos",
        "warrantyClaims",
      ].sort(),
    );
    const narrowing = Object.fromEntries(schema.soft.map((t) => [t, [...schema.tables.get(t)!.scoping].sort()]));
    expect(narrowing).toEqual({
      // A tenant's own, under no project.
      budgetExclusionPresets: [],
      projects: ["id"],
      projectDocuments: ["budgetRevisionId", "id", "projectId"],
      projectPhotos: ["id", "projectId"],
      obraIssueFiles: ["id", "issueId"],
      subcontractorAssignments: ["id", "projectId"],
      purchaseOrderDocuments: ["id", "orderId"],
      purchaseInvoices: ["id", "milestoneId", "orderId", "rectifiesId"],
      purchasePayments: ["id", "invoiceId"],
    });
  });

  it("reads a key on the column, in the table's extra config, through a schema helper, or to the table itself", () => {
    const read = readSchema(`
      const projects = pgTable("projects", { id: text("id"), tenantId: text("tenant_id") });
      const under = (name: string, table: { tenantId: AnyPgColumn; projectId: AnyPgColumn }) =>
        foreignKey({ name, columns: [table.tenantId, table.projectId], foreignColumns: [projects.tenantId, projects.id] });
      const byColumn = pgTable("by_column", { id: text("id"), projectId: text("project_id").references(() => projects.id) });
      const byHelper = pgTable("by_helper", { id: text("id"), tenantId: text("tenant_id"), projectId: text("project_id") }, (table) => ({ fk: under("fk", table) }));
      const byKey = pgTable("by_key", { id: text("id"), tenantId: text("tenant_id"), parentId: text("parent_id"), ownId: text("own_id") }, (t) => ({
        parent: foreignKey({ name: "p", columns: [t.tenantId, t.parentId], foreignColumns: [byHelper.tenantId, byHelper.id] }).onDelete("cascade"),
        own: foreignKey({ name: "o", columns: [t.tenantId, t.ownId], foreignColumns: [t.tenantId, t.id] }),
      }));
      const loose = pgTable("loose", { id: text("id"), tenantId: text("tenant_id") });`);
    const scoping = (t: string) => [...read.tables.get(t)!.scoping].sort();
    expect([...read.tables.values()].filter((t) => t.underProject).map((t) => t.name).sort()).toEqual(["byColumn", "byHelper", "byKey", "projects"]);
    expect(scoping("byKey")).toEqual(["id", "ownId", "parentId"]);
    expect(scoping("loose")).toEqual([]);
  });

  it("finds the reads of every one of them", () => {
    expect(files.length).toBeGreaterThan(300);
    for (const table of schema.soft) expect(report.reads.filter((r) => r.table === table).length, table).toBeGreaterThan(0);
    expect(report.reads.length).toBeGreaterThan(150);
  });

  it("leaves deleted rows, and a deleted project's, out of every read", () => {
    expect(report.problems.map((p) => `${where(p)} ${p.message}`)).toEqual([]);
  });
});

// ─── The guard itself ────────────────────────────────────────────────────────

/** The real helpers, at the path a fixture imports them from. */
const helpers = { path: "/fx/project-client.ts", text: readFileSync(join(repo, "packages/core/src/project-client.ts"), "utf8") };

const IMPORTS = `import { alias } from "drizzle-orm/pg-core";
import { and, db, eq, exists, inArray, isNull, isNotNull, ne, not, notExists, notInArray, or, sql, projects, projectDocuments, projectPhotos, purchaseInvoices, purchasePayments, purchaseOrders, users } from "@repo/db";
import { inLiveProject, projectIdsInTenant, projectInTenant, projectNotDeleted, projectsInTenant } from "./project-client";
`;

function check(code: string): Report {
  return analyze([helpers, { path: "/fx/q.ts", text: IMPORTS + code }], schema);
}
const problems = (code: string) => check(code).problems.map((p) => p.message);
const ROWS = (table: string) => `doesn't leave out deleted rows (isNull(${table}.deletedAt))`;
const PROJECT = "doesn't leave out a deleted project's rows";

describe("the soft-delete guard", () => {
  it("fails a read without the filter, passes one with it", () => {
    expect(problems(`export const q = (id: string) => db.select().from(projects).where(eq(projects.id, id));`)).toEqual([`select of projects ${ROWS("projects")}`]);
    expect(problems(`export const q = (id: string) => db.select().from(projects).where(and(eq(projects.id, id), isNull(projects.deletedAt)));`)).toEqual([]);
  });

  it("takes the helpers, from another file or a local const, and a condition built apart", () => {
    expect(problems(`export const q = (t: string, id: string) => db.select().from(projects).where(projectInTenant(t, id));`)).toEqual([]);
    expect(problems(`export const q = () => db.select().from(projects).where(projectNotDeleted());`)).toEqual([]);
    expect(
      problems(`
        const live = isNull(projectDocuments.deletedAt);
        export async function q(projectId: string) {
          const conditions = [eq(projectDocuments.projectId, projectId)];
          conditions.push(live);
          return db.select().from(projectDocuments).where(and(...conditions));
        }`),
    ).toEqual([]);
  });

  it("takes only what every return of a helper proves", () => {
    const helper = (body: string) => problems(`function filter(all: boolean) { ${body} }
      export const q = (all: boolean) => db.select().from(projects).where(filter(all));`);
    expect(helper("if (all) return undefined; return isNull(projects.deletedAt);")).toEqual([`select of projects ${ROWS("projects")}`]);
    expect(helper("if (all) return; return isNull(projects.deletedAt);")).toHaveLength(1);
    expect(helper("if (all) return and(isNull(projects.deletedAt), eq(projects.ref, 'x')); return isNull(projects.deletedAt);")).toEqual([]);
  });

  it("takes nothing from a variable written again, nor from a push under a condition", () => {
    expect(
      problems(`export const q = (all: boolean) => { let cond = isNull(projects.deletedAt); if (all) cond = undefined as never; return db.select().from(projects).where(cond); };`),
    ).toEqual([`select of projects ${ROWS("projects")}`]);
    expect(problems(`export const q = () => { let cond = isNull(projects.deletedAt); return db.select().from(projects).where(cond); };`)).toEqual([]);
    expect(
      problems(`export const q = (all: boolean) => { const c = [eq(projects.ref, "x")]; if (!all) { c.push(isNull(projects.deletedAt)); } return db.select().from(projects).where(and(...c)); };`),
    ).toHaveLength(1);
  });

  it("doesn't take a filter under a negation or in one branch only; `or` keeps what all its branches prove", () => {
    expect(problems(`export const q = (id: string) => db.select().from(projects).where(or(eq(projects.id, id), isNull(projects.deletedAt)));`)).toHaveLength(1);
    expect(problems(`export const q = (id: string) => db.select().from(projects).where(or(and(eq(projects.id, id), isNull(projects.deletedAt)), projectNotDeleted()));`)).toEqual([]);
    expect(problems(`export const q = () => db.select().from(projects).where(not(isNotNull(projects.deletedAt)));`)).toHaveLength(1);
    expect(problems(`export const q = (all: boolean) => db.select().from(projects).where(all ? undefined : projectNotDeleted());`)).toHaveLength(1);
    expect(problems(`export const q = (all: boolean) => db.select().from(projects).where(all ? projectNotDeleted() : isNull(projects.deletedAt));`)).toEqual([]);
  });

  it("takes only conditions: a filter among the selected fields proves nothing", () => {
    expect(problems("export const q = () => db.select({ live: sql`${projects.deletedAt} is null` }).from(projects);")).toHaveLength(1);
    expect(problems("export const q = () => db.select().from(projects).where(sql`${projects.deletedAt} is null`);")).toEqual([]);
  });

  it("takes what every use adds to a builder kept in a const or returned by an arrow", () => {
    const callers = (second: string) =>
      problems(`export async function q(id: string) {
        const rows = () => db.select().from(projects);
        return [await rows().where(projectNotDeleted()), await rows().where(${second})];
      }`);
    expect(callers("and(eq(projects.id, id), projectNotDeleted())")).toEqual([]);
    expect(callers("eq(projects.id, id)")).toHaveLength(1);
    // `$dynamic()`: every use finishes it with the filter, or it fails.
    expect(problems(`export async function q(p: string) { const qb = db.select().from(projects).$dynamic(); return qb.where(and(eq(projects.id, p), isNull(projects.deletedAt))); }`)).toEqual([]);
    expect(problems(`export async function q(p: string) { const qb = db.select().from(projects).$dynamic(); return [await qb.where(projectNotDeleted()), await qb.limit(1)]; }`)).toHaveLength(1);
    expect(problems(`export async function q(p: string, run: (x: unknown) => unknown) { const qb = db.select().from(projects).$dynamic(); return run(qb); }`)).toHaveLength(1);
  });

  it("tells sources apart by alias, not by table", () => {
    const aliased = (filter: string) =>
      problems(`export const q = (p: string) => { const a = alias(projectDocuments, "a"); const b = alias(projectDocuments, "b");
        return db.select().from(a).innerJoin(b, eq(a.id, b.id)).where(and(eq(a.projectId, p), ${filter})); };`);
    expect(aliased("isNull(a.deletedAt)")).toEqual([`join of projectDocuments ${ROWS("projectDocuments")}`]);
    expect(aliased("isNull(a.deletedAt), isNull(b.deletedAt)")).toEqual([]);
  });

  it("fails a join to a soft-deleted table without its filter", () => {
    const join = (on: string) => problems(`export const q = (t: string) => db.select().from(users).innerJoin(projects, ${on}).where(eq(users.tenantId, t));`);
    expect(join(`eq(projects.clientUserId, users.id)`)).toEqual([`join of projects ${ROWS("projects")}`]);
    expect(join(`and(eq(projects.clientUserId, users.id), projectNotDeleted())`)).toEqual([]);
  });

  it("takes a left join's on only for the rows of the table it joins", () => {
    // A filter on the joined projects in a left join's on keeps a deleted project's documents (with no project).
    expect(
      problems(`export const q = (t: string) => db.select().from(projectDocuments)
        .leftJoin(projects, and(eq(projects.id, projectDocuments.projectId), isNull(projects.deletedAt)))
        .where(and(eq(projectDocuments.tenantId, t), isNull(projectDocuments.deletedAt)));`),
    ).toEqual([`select of projectDocuments ${PROJECT}`]);
    expect(
      problems(`export const q = (t: string) => db.select().from(projectDocuments)
        .innerJoin(projects, and(eq(projects.id, projectDocuments.projectId), isNull(projects.deletedAt)))
        .where(and(eq(projectDocuments.tenantId, t), isNull(projectDocuments.deletedAt)));`),
    ).toEqual([]);
    // The read table's filter in a left join's on filters nothing of it.
    expect(
      problems(`export const q = (p: string) => db.select().from(projectDocuments)
        .leftJoin(users, and(eq(users.id, projectDocuments.uploadedById), isNull(projectDocuments.deletedAt)))
        .where(eq(projectDocuments.projectId, p));`),
    ).toEqual([`select of projectDocuments ${ROWS("projectDocuments")}`]);
    // The joined table's own filter in its on does leave its deleted rows out (but proves nothing of the project).
    expect(problems(`export const q = (p: string) => db.select().from(users).leftJoin(projectDocuments, isNull(projectDocuments.deletedAt)).where(eq(users.id, p));`)).toEqual([
      `join of projectDocuments ${PROJECT}`,
    ]);
    expect(
      problems(`export const q = (p: string) => db.select().from(projectPhotos)
        .leftJoin(projectDocuments, and(eq(projectDocuments.projectId, projectPhotos.projectId), isNull(projectDocuments.deletedAt)))
        .where(and(eq(projectPhotos.projectId, p), isNull(projectPhotos.deletedAt)));`),
    ).toEqual([]);
  });

  it("fails raw SQL that names the table unless that very occurrence filters it", () => {
    expect(problems("export const q = (t: string) => db.execute(sql`select id from ${projects} p where p.tenant_id = ${t}`);")).toEqual([`sql of projects (as p) ${ROWS("projects")}`]);
    expect(problems("export const q = (t: string) => db.execute(sql`select id from projects where tenant_id = ${t}`);")).toHaveLength(1);
    expect(problems("export const q = (t: string) => db.execute(sql`select id from ${projects} p where p.tenant_id = ${t} and p.deleted_at is null`);")).toEqual([]);
    expect(problems("export const q = (t: string) => db.execute(sql`select id from projects where tenant_id = ${t} and deleted_at is null`);")).toEqual([]);
    // Another subquery's filter, under the same alias, covers nothing here.
    expect(
      problems(
        "export const q = (t: string) => db.execute(sql`select (select count(*) from ${projects} p where p.tenant_id = ${t}), (select count(*) from ${projects} p where p.deleted_at is null)`);",
      ),
    ).toHaveLength(1);
    // A fragment that is only sometimes there is read on its own.
    expect(problems("export const q = (all: boolean) => db.execute(sql`select 1 ${all ? sql`from ${projects} p` : sql``}`);")).toHaveLength(1);
  });

  it("takes a raw filter only at its table's own select, in a where or on, and under no `or`", () => {
    expect(problems("export const q = (t: string) => db.execute(sql`select id from projects p where p.tenant_id = ${t} and (p.deleted_at is null or true)`);")).toEqual([
      `sql of projects (as p) ${ROWS("projects")}`,
    ]);
    expect(problems("export const q = (t: string) => db.execute(sql`select id from projects p where p.tenant_id = ${t} and (p.deleted_at is null and true)`);")).toEqual([]);
    expect(problems("export const q = (t: string) => db.execute(sql`select (p.deleted_at is null) as live from projects p where p.tenant_id = ${t}`);")).toHaveLength(1);
    // A bare filter in a subquery is that subquery's; a project narrowed there narrows only it.
    expect(
      problems(
        "export const q = (t: string) => db.execute(sql`select id, (select count(*) from project_photos where deleted_at is null and project_id = ${t}) from project_documents where tenant_id = ${t}`);",
      ),
    ).toEqual([`sql of projectDocuments ${ROWS("projectDocuments")} and ${PROJECT}`]);
    expect(
      problems(
        "export const q = (t: string) => db.execute(sql`select id, (select count(*) from project_photos f where f.deleted_at is null) from project_documents where project_id = ${t} and deleted_at is null`);",
      ),
    ).toEqual([]);
  });

  it("reads comma lists, schema-qualified names, fragments in sql.join, and refuses sql.raw", () => {
    expect(
      problems("export const q = (t: string) => db.execute(sql`select d.id from projects p, project_documents d where p.tenant_id = ${t} and p.deleted_at is null and d.project_id = p.id`);"),
    ).toEqual([`sql of projectDocuments (as d) ${ROWS("projectDocuments")}`]);
    expect(
      problems(
        "export const q = (t: string) => db.execute(sql`select d.id from projects p, project_documents d where p.tenant_id = ${t} and p.deleted_at is null and d.deleted_at is null and d.project_id = p.id`);",
      ),
    ).toEqual([]);
    expect(problems("export const q = (t: string) => db.execute(sql`select id from public.project_documents where tenant_id = ${t}`);")).toEqual([
      `sql of projectDocuments ${ROWS("projectDocuments")} and ${PROJECT}`,
    ]);
    expect(problems("export const q = (p: string) => db.execute(sql`select id from public.project_documents where project_id = ${p} and deleted_at is null`);")).toEqual([]);
    expect(problems("export const q = (t: string) => db.execute(sql`select ${sql.join([sql`(select count(*) from project_documents where tenant_id = ${t})`], sql`, `)}`);")).toHaveLength(1);
    expect(problems("export const q = (p: string) => db.execute(sql`select ${sql.join([sql`(select count(*) from project_documents where project_id = ${p} and deleted_at is null)`], sql`, `)}`);")).toEqual([]);
    expect(problems("export const q = () => db.execute(sql.raw('select id from project_documents'));")).toEqual([
      "raw of projectDocuments names a soft-deleted table in sql.raw, which no check can read",
    ]);
    expect(problems("export const q = () => db.execute(sql.raw('set local statement_timeout = 100'));")).toEqual([]);
  });

  it("fails a relational query or a `with` without the filter, wherever the `with` is written", () => {
    expect(problems(`export const q = (id: string) => db.query.projects.findFirst({ where: eq(projects.id, id) });`)).toHaveLength(1);
    expect(problems(`export const q = (id: string) => db.query.projects.findFirst({ where: (p, { and, eq, isNull }) => and(eq(p.id, id), isNull(p.deletedAt)) });`)).toEqual([]);
    expect(problems(`export const q = (t: string, id: string) => db.query.projects.findFirst({ where: projectInTenant(t, id), with: { documents: true } });`)).toEqual([
      `with of projectDocuments ${ROWS("projectDocuments")}`,
    ]);
    expect(
      problems(`export const q = (t: string, id: string) => db.query.projects.findFirst({ where: projectInTenant(t, id), with: { documents: { where: isNull(projectDocuments.deletedAt) } } });`),
    ).toEqual([]);
    // Kept in a const, spread: still read.
    expect(problems(`const withDocs = { documents: true } as const; export const q = (t: string, id: string) => db.query.projects.findFirst({ where: projectInTenant(t, id), with: withDocs });`)).toHaveLength(1);
    expect(problems(`const base = { documents: true } as const; export const q = (t: string, id: string) => db.query.projects.findFirst({ where: projectInTenant(t, id), with: { ...base } });`)).toHaveLength(1);
    expect(
      problems(
        `const base = { documents: { where: isNull(projectDocuments.deletedAt) } } as const; export const q = (t: string, id: string) => db.query.projects.findFirst({ where: projectInTenant(t, id), with: { ...base } });`,
      ),
    ).toEqual([]);
    // One it can't read at all fails.
    expect(problems(`declare const make: () => object; export const q = (t: string, id: string) => db.query.projects.findFirst({ where: projectInTenant(t, id), with: make() });`)).toEqual([
      "with on projects that can't be read",
    ]);
  });

  it("fails a tenant-wide read of a project's rows that keeps a deleted project's", () => {
    const read = (extra: string) =>
      problems(`export const q = (t: string) => db.select().from(projectPhotos).where(and(eq(projectPhotos.tenantId, t), isNull(projectPhotos.deletedAt)${extra}));`);
    expect(read("")).toEqual([`select of projectPhotos ${PROJECT}`]);
    expect(read(", inArray(projectPhotos.projectId, projectIdsInTenant(t))")).toEqual([]);
    expect(read(", inLiveProject(projectPhotos.projectId)")).toEqual([]);
    expect(read(", notInArray(projectPhotos.projectId, projectIdsInTenant(t))")).toHaveLength(1);
    expect(read(", notExists(db.select().from(projects).where(and(eq(projects.id, projectPhotos.projectId), isNull(projects.deletedAt))))")).toHaveLength(1);
    expect(read(", exists(db.select().from(projects).where(and(eq(projects.id, projectPhotos.projectId), isNull(projects.deletedAt))))")).toEqual([]);
    expect(read(", ne(projectPhotos.projectId, t)")).toHaveLength(1);
    // Narrowed to one project by value: the caller is trusted to have checked it.
    expect(problems(`export const q = (p: string) => db.select().from(projectPhotos).where(and(eq(projectPhotos.projectId, p), isNull(projectPhotos.deletedAt)));`)).toEqual([]);
    // A payment through a join to a live project.
    expect(
      problems(`export const q = (t: string) => db.select().from(purchasePayments)
        .innerJoin(purchaseInvoices, and(eq(purchaseInvoices.id, purchasePayments.invoiceId), isNull(purchaseInvoices.deletedAt)))
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseInvoices.orderId))
        .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
        .where(and(eq(purchasePayments.tenantId, t), isNull(purchasePayments.deletedAt), projectsInTenant(t)));`),
    ).toEqual([]);
  });

  it("narrows by value only: never by a subquery or a column", () => {
    const invoices = (orders: string) =>
      problems(`export const q = (t: string, p: string, orderIds: string[]) => db.select().from(purchaseInvoices)
        .where(and(isNull(purchaseInvoices.deletedAt), inArray(purchaseInvoices.orderId, ${orders})));`);
    expect(invoices(`db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.tenantId, t))`)).toEqual([`select of purchaseInvoices ${PROJECT}`]);
    // The subquery narrowed to one project narrows these too; an array of ids the caller holds does.
    expect(invoices(`db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.projectId, p))`)).toEqual([]);
    expect(invoices(`orderIds`)).toEqual([]);
    // By its own id (after `requireInvoice`): the same trust as a parent.
    expect(problems(`export const q = (id: string) => db.select().from(purchaseInvoices).where(and(eq(purchaseInvoices.id, id), isNull(purchaseInvoices.deletedAt)));`)).toEqual([]);
    // A subquery held in a const is no value either.
    expect(
      problems(`export const q = (t: string) => { const ids = db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.tenantId, t));
        return db.select().from(purchaseInvoices).where(and(isNull(purchaseInvoices.deletedAt), inArray(purchaseInvoices.orderId, ids))); };`),
    ).toEqual([`select of purchaseInvoices ${PROJECT}`]);
    // A key that spans obras (a company's) narrows nothing.
    expect(problems(`export const q = (s: string) => db.select().from(purchaseInvoices).where(and(isNull(purchaseInvoices.deletedAt), eq(purchaseInvoices.subcontractorId, s)));`)).toEqual([
      `select of purchaseInvoices ${PROJECT}`,
    ]);
  });

  it("follows a table through a const or a parameter typed as it", () => {
    expect(problems(`export const q = (photo: boolean) => { const t = photo ? projectPhotos : projectDocuments; return db.select().from(t); };`)).toHaveLength(2);
    expect(problems(`export const q = (t: typeof projectDocuments) => db.select().from(t).where(isNull(t.deletedAt));`)).toEqual([`select of projectDocuments ${PROJECT}`]);
  });

  it("never lets a soft-deleted table be erased", () => {
    expect(problems(`export const q = (id: string) => db.delete(projectDocuments).where(and(eq(projectDocuments.id, id), isNull(projectDocuments.deletedAt)));`)).toEqual([
      "delete of projectDocuments erases rows of a soft-deleted table",
    ]);
  });

  it("takes a marker that names its tables and gives a reason, next to the read", () => {
    const marked = check(`export async function q(id: string) {
      // soft-delete-ok(projects): a restore reads the deleted row it brings back.
      const [row] = await db.select().from(projects).where(and(eq(projects.id, id), isNotNull(projects.deletedAt)));
      return row;
    }`);
    expect(marked.problems).toEqual([]);
    expect(marked.reads.filter((r) => r.file === "/fx/q.ts")).toMatchObject([{ table: "projects", marker: "a restore reads the deleted row it brings back." }]);
  });

  it("fails a marker without a reason or a table, naming what its query doesn't read or reads correctly", () => {
    const marked = (marker: string, query = "db.select().from(projects).where(eq(projects.id, id))") =>
      problems(`export async function q(id: string) {
        ${marker}
        return ${query};
      }`);
    expect(marked("// soft-delete-ok(projects):")).toEqual(["soft-delete-ok marker without a reason"]);
    expect(marked("// soft-delete-ok: no table named.")).toEqual([
      `select of projects ${ROWS("projects")}`,
      "soft-delete-ok marker that names no table: soft-delete-ok(table, …): reason",
    ]);
    expect(marked("// soft-delete-ok(projects, projectPhotos): photos aren't read here.")).toEqual(["soft-delete-ok marker names projectPhotos, which its query doesn't read"]);
    expect(marked("// soft-delete-ok(users): not soft-deleted.")).toEqual([`select of projects ${ROWS("projects")}`, "soft-delete-ok marker names users, not a soft-deleted table"]);
    expect(marked("// soft-delete-ok(projects): nothing to excuse here.", "db.select().from(projects).where(projectNotDeleted())")).toEqual([
      "soft-delete-ok marker names projects, whose reads need no excuse",
    ]);
  });

  it("excuses only the tables a marker names, in its own query", () => {
    // A join added to a marked query is still checked.
    expect(
      problems(`export async function q(t: string) {
        // soft-delete-ok(projectDocuments): lists deleted documents.
        return db.select().from(projectDocuments).innerJoin(projectPhotos, eq(projectPhotos.projectId, projectDocuments.projectId)).where(and(eq(projectDocuments.tenantId, t), isNotNull(projectDocuments.deletedAt)));
      }`),
    ).toEqual([`join of projectPhotos ${ROWS("projectPhotos")} and ${PROJECT}`]);
    expect(
      problems(`export async function q(id: string) {
        // soft-delete-ok(projects): only the first one.
        const a = await db.select().from(projects).where(eq(projects.id, id));
        const b = await db.select().from(projects).where(eq(projects.id, id));
        return [a, b];
      }`),
    ).toEqual([`select of projects ${ROWS("projects")}`]);
  });
});
