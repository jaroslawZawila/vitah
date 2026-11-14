import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { db, eq, projects } from "@repo/db";
import { createTestProject, createTestTenant, resetDatabase } from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { apiRequest, routeParams, staffToken } from "../../../../test/api";
import { GET as list, POST as create } from "./route";
import { GET as overview } from "./overview/route";
import { GET as projectsRoute } from "./projects/route";
import { GET as dossier } from "./dossier/route";
import { GET as detail, PATCH as update } from "./[id]/route";
import { POST as upload } from "./[id]/documents/route";
import { POST as requestDocs } from "./[id]/documents/request/route";
import { POST as notApplicable } from "./[id]/documents/not-applicable/route";
import { POST as validate } from "./[id]/documents/[documentId]/validate/route";
import { POST as reject } from "./[id]/documents/[documentId]/reject/route";
import { GET as version } from "./[id]/versions/[versionId]/route";
import { DELETE as unassign, PUT as assign } from "./[id]/assignments/[projectId]/route";
import { GET as listWorkers, POST as createWorker } from "./workers/route";
import { GET as workerDetail, PATCH as updateWorker } from "./workers/[workerId]/route";
import { GET as check } from "./workers/check/route";

// Bearer requests never read the NextAuth session, and next-auth itself
// can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

const company = {
  kind: "company",
  legalName: "Electricidad Saja S.L.",
  taxId: "B39123450",
  address: "C/ Ramón y Cajal 14",
  postalCode: "39300",
  city: "Torrelavega",
};

function pdfForm(requirementId: string, extra: Record<string, string> = {}) {
  const body = new FormData();
  body.set("requirementId", requirementId);
  body.set("issuedAt", "2026-10-01");
  for (const [key, value] of Object.entries(extra)) body.set(key, value);
  body.set("file", new File(["%PDF-1.7 certificado"], "certificado.pdf", { type: "application/pdf" }));
  return body;
}

async function setup(role: "admin" | "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const { token } = await staffToken(tenant.id, role);
  return { tenant, token };
}

async function createCompany(token: string) {
  const res = await create(apiRequest(token, { method: "POST", body: company }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("/api/v1/subcontractors", () => {
  it("creates, lists, reads and updates a company", async () => {
    const { token } = await setup();
    const id = await createCompany(token);

    expect(await (await list(apiRequest(token))).json()).toEqual([
      expect.objectContaining({ id, legalName: "Electricidad Saja S.L.", taxIdMasked: "B39•••450", status: "pendiente" }),
    ]);
    const patched = await update(apiRequest(token, { method: "PATCH", body: { phone: "942 81 64 20" } }), routeParams({ id }));
    expect(patched.status).toBe(200);
    expect(await (await detail(apiRequest(token), routeParams({ id }))).json()).toMatchObject({
      id,
      phone: "942 81 64 20",
      reaRegion: "cantabria",
    });
    expect((await (await overview(apiRequest(token))).json()).counts).toEqual({ apta: 0, pendiente: 1, bloqueada: 0 });
  });

  it("answers expected failures as { error }", async () => {
    const { token } = await setup();
    const res = await create(apiRequest(token, { method: "POST", body: { ...company, taxId: "B39123451" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_tax_id" });

    await createCompany(token);
    const duplicate = await create(apiRequest(token, { method: "POST", body: company }));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "tax_id_exists" });
  });

  it("uploads, reviews, downloads and asks for documents", async () => {
    const { token } = await setup();
    const id = await createCompany(token);

    const uploaded = await upload(apiRequest(token, { method: "POST", body: pdfForm("cert_tgss") }), routeParams({ id }));
    expect(uploaded.status).toBe(201);
    const { versionId } = (await uploaded.json()) as { versionId: string };
    const file = await version(apiRequest(token), routeParams({ id, versionId }));
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(await file.text()).toBe("%PDF-1.7 certificado");

    const docs = ((await (await detail(apiRequest(token), routeParams({ id }))).json()) as {
      documents: { id: string | null; requirementId: string }[];
    }).documents;
    const documentId = docs.find((d) => d.requirementId === "cert_tgss")!.id!;
    expect((await validate(apiRequest(token, { method: "POST" }), routeParams({ id, documentId }))).status).toBe(200);
    const again = await reject(apiRequest(token, { method: "POST", body: { reason: "x" } }), routeParams({ id, documentId }));
    expect(again.status).toBe(409);

    const asked = await requestDocs(
      apiRequest(token, { method: "POST", body: { requirementIds: ["poliza_rc_subcontrata"] } }),
      routeParams({ id }),
    );
    expect(asked.status).toBe(200);
    const na = await notApplicable(
      apiRequest(token, { method: "POST", body: { requirementId: "cert_tgss", reason: "x" } }),
      routeParams({ id }),
    );
    expect(await na.json()).toEqual({ error: "not_optional" });
  });

  it("assigns to an obra, lists its projects and exports the dossier", async () => {
    const { tenant, token } = await setup();
    const id = await createCompany(token);
    const project = await createTestProject(tenant.id, { ref: "VTH-26-001" });

    const put = await assign(
      apiRequest(token, { method: "PUT", body: { chapterCodes: ["13", "14"], bookOrder: 7, bookDate: "2026-09-20" } }),
      routeParams({ id, projectId: project.id }),
    );
    expect(put.status).toBe(200);
    expect(await (await projectsRoute(apiRequest(token))).json()).toEqual([
      expect.objectContaining({ id: project.id, ref: "VTH-26-001" }),
    ]);

    const zip = await dossier(apiRequest(token, { query: `?projectId=${project.id}` }));
    expect(zip.headers.get("content-type")).toBe("application/zip");
    expect(zip.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''dossier-cae-VTH-26-001-/);
    expect(Object.keys(unzipSync(new Uint8Array(await zip.arrayBuffer())))).toEqual(["indice.csv"]);

    const remove = () => unassign(apiRequest(token, { method: "DELETE" }), routeParams({ id, projectId: project.id }));
    expect((await remove()).status).toBe(204);
    expect(((await (await detail(apiRequest(token), routeParams({ id }))).json()) as { assignments: unknown[] }).assignments).toEqual([]);
    // Already removed: nothing to remove.
    const again = await remove();
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: "not_found" });

    // Assigned again: the same call as the first time, as a new assignment.
    const back = await assign(
      apiRequest(token, { method: "PUT", body: { chapterCodes: ["05"] } }),
      routeParams({ id, projectId: project.id }),
    );
    expect(back.status).toBe(200);
    expect(await back.json()).toEqual({ subcontractorId: id, projectId: project.id });
    expect(await (await detail(apiRequest(token), routeParams({ id }))).json()).toMatchObject({
      assignments: [{ projectId: project.id, chapterCodes: ["05"], bookOrder: null, bookDate: null }],
    });
  });

  it("keeps removing a company from an obra from viewers and other tenants", async () => {
    const { tenant, token } = await setup();
    const id = await createCompany(token);
    const project = await createTestProject(tenant.id);
    await assign(apiRequest(token, { method: "PUT", body: {} }), routeParams({ id, projectId: project.id }));
    const { token: viewer } = await staffToken(tenant.id, "viewer");
    const { token: stranger } = await setup();

    const params = () => routeParams({ id, projectId: project.id });
    expect((await unassign(apiRequest(viewer, { method: "DELETE" }), params())).status).toBe(403);
    expect((await unassign(apiRequest(stranger, { method: "DELETE" }), params())).status).toBe(404);
    expect(await (await detail(apiRequest(token), routeParams({ id }))).json()).toMatchObject({
      assignments: [{ projectId: project.id }],
    });
  });

  it("leaves a deleted obra out: not offered, not assignable, no access check", async () => {
    const { tenant, token } = await setup();
    const id = await createCompany(token);
    const gone = await createTestProject(tenant.id, { ref: "VTH-26-001" });
    const kept = await createTestProject(tenant.id, { ref: "VTH-26-002" });
    await assign(apiRequest(token, { method: "PUT", body: {} }), routeParams({ id, projectId: gone.id }));
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, gone.id));

    expect(await (await projectsRoute(apiRequest(token))).json()).toEqual([expect.objectContaining({ id: kept.id })]);
    expect(await (await detail(apiRequest(token), routeParams({ id }))).json()).toMatchObject({ assignments: [] });
    const notFound = async (res: Response, error: string) => {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error });
    };
    const params = routeParams({ id, projectId: gone.id });
    await notFound(await assign(apiRequest(token, { method: "PUT", body: {} }), params), "project_not_found");
    await notFound(await unassign(apiRequest(token, { method: "DELETE" }), params), "not_found");
    await notFound(await dossier(apiRequest(token, { query: `?projectId=${gone.id}` })), "project_not_found");
    await notFound(await check(apiRequest(token, { query: `?query=72145836B&projectId=${gone.id}` })), "project_not_found");
  });

  it("creates workers and checks their access", async () => {
    const { token } = await setup();
    const id = await createCompany(token);

    const created = await createWorker(
      apiRequest(token, {
        method: "POST",
        body: { subcontractorId: id, firstName: "Iván", surnames: "Gómez Ruiz", idDocument: "72145836B" },
      }),
    );
    expect(created.status).toBe(201);
    const { id: workerId } = (await created.json()) as { id: string };

    await updateWorker(apiRequest(token, { method: "PATCH", body: { tpcNumber: "39-0123456" } }), routeParams({ workerId }));
    expect(await (await workerDetail(apiRequest(token), routeParams({ workerId }))).json()).toMatchObject({
      tpcNumber: "390123456",
      companyStatus: "pendiente",
    });
    expect(await (await listWorkers(apiRequest(token))).json()).toEqual([
      expect.objectContaining({ id: workerId, idDocumentMasked: "72•••836B" }),
    ]);
    const checked = await check(apiRequest(token, { query: "?query=39-0123456" }));
    expect(await checked.json()).toMatchObject({ worker: { id: workerId }, access: { status: "pending" } });
  });

  it("lists every worker without parameters, and a page of them with ?page or ?limit", async () => {
    const { token } = await setup();
    const id = await createCompany(token);
    const people = [
      ["Ana", "Abascal Ruiz", "00000001R"],
      ["Laura", "Cobo Gil", "00000002W"],
      ["Hugo", "Díaz Mazo", "00000003A"],
    ] as const;
    const ids: string[] = [];
    for (const [firstName, surnames, idDocument] of people) {
      const created = await createWorker(apiRequest(token, { method: "POST", body: { subcontractorId: id, firstName, surnames, idDocument } }));
      ids.push(((await created.json()) as { id: string }).id);
    }
    const get = async (query = "") => {
      const response = await listWorkers(apiRequest(token, { query }));
      return { status: response.status, body: await response.json() };
    };

    // As it always answered: an array of every worker.
    const all = await get();
    expect(Array.isArray(all.body)).toBe(true);
    expect(all.body.map((w: { id: string }) => w.id)).toEqual(ids);

    const first = await get("?page=1&limit=2");
    expect(first.body.workers.map((w: { id: string }) => w.id)).toEqual(ids.slice(0, 2));
    expect(first.body.paging).toEqual({ page: 1, limit: 2, total: 3, pages: 2 });
    expect(first.body.counts).toEqual({ all: 3, ok: 0, pending: 3, blocked: 0 });
    expect(first.body.summary).toEqual({ registered: 3, companies: 1, ok: 0, pending: 3, blocked: 0, preventive: 0 });
    expect((await get("?page=2&limit=2")).body.workers.map((w: { id: string }) => w.id)).toEqual(ids.slice(2));
    expect((await get("?page=5&limit=2")).body).toMatchObject({ workers: [], paging: { page: 5, total: 3, pages: 2 } });
    expect((await get("?limit=1000000")).body.paging).toMatchObject({ page: 1, limit: 200, total: 3 });
    expect((await get("?page=1&q=cobo")).body.workers.map((w: { id: string }) => w.id)).toEqual([ids[1]]);
    expect((await get("?page=1&access=ok")).body).toMatchObject({ workers: [], paging: { total: 0 }, counts: { all: 3 } });
    expect((await get(`?page=1&companyId=${id}`)).body.paging.total).toBe(3);

    for (const query of ["?page=0", "?page=abc", "?limit=0"]) {
      expect(await get(query), query).toEqual({ status: 400, body: { error: "invalid_page" } });
    }
    expect(await get("?page=1&access=nope")).toEqual({ status: 400, body: { error: "invalid_option" } });

    // Another tenant pages through nothing.
    const { token: stranger } = await setup();
    expect(await (await listWorkers(apiRequest(stranger, { query: `?page=1&companyId=${id}` }))).json()).toMatchObject({ workers: [], paging: { total: 0 } });
    expect((await listWorkers(apiRequest(null, { query: "?page=1" }))).status).toBe(401);
  });

  it("keeps viewers to reading and tenants apart", async () => {
    const { token } = await setup();
    const id = await createCompany(token);

    const { tenant: other, token: viewerToken } = await setup("viewer");
    expect(other).toBeTruthy();
    const read = await detail(apiRequest(viewerToken), routeParams({ id }));
    expect(read.status).toBe(404);
    expect(await (await list(apiRequest(viewerToken))).json()).toEqual([]);

    const res = await create(apiRequest(viewerToken, { method: "POST", body: company }));
    expect(res.status).toBe(403);
  });

  it("needs a token", async () => {
    expect((await list(apiRequest(null))).status).toBe(401);
  });
});
