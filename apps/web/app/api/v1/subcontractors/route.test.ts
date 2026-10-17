import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
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

    expect((await unassign(apiRequest(token, { method: "DELETE" }), routeParams({ id, projectId: project.id }))).status).toBe(204);
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
