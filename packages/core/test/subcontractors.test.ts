import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  db,
  eq,
  projects,
  sql,
  subcontractorAssignments,
  subcontractorAudit,
  subcontractorDocumentVersions,
} from "@repo/db";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import {
  MANDATORY_COMPANY_REQUIREMENTS,
  addMonths,
  subcontractorsService as svc,
  subcontractorWorkersService as workers,
  type Ctx,
} from "../src";
import { files } from "../src/testing";
import { addDays, todayInSpain } from "../src/obra-calc";

vi.mock("../src/storage", () => import("../src/testing"));

const today = todayInSpain();
const inDays = (days: number) => addDays(today, days);

const pdf = (content = "%PDF-1.7\ncertificado") => new File([content], "certificado.pdf", { type: "application/pdf" });

const company = (overrides: Record<string, unknown> = {}) => ({
  kind: "company",
  legalName: "Electricidad Saja S.L.",
  taxId: "B-39123450",
  address: "C/ Ramón y Cajal 14",
  postalCode: "39300",
  city: "Torrelavega",
  phone: "942 81 64 20",
  email: "Administracion@ElectricidadSaja.es",
  trades: ["electrical", "telecom"],
  headcount: 9,
  permanentCount: 6,
  preventionMode: "external_service",
  ...overrides,
});

const workerInput = (subcontractorId: string, overrides: Record<string, unknown> = {}) => ({
  subcontractorId,
  firstName: "Iván",
  surnames: "Gómez Ruiz",
  idDocument: "72145836b",
  trade: "electrical",
  category: "officer_1",
  tpcNumber: "39-0123456",
  ...overrides,
});

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin", name: "Ana Requejo" });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  const { id } = await svc.createSubcontractor(ctx, company());
  return { tenant, admin, ctx, id };
}

/** Uploads a version and validates it. */
async function validDoc(ctx: Ctx, subcontractorId: string, requirementId: string, input: Record<string, unknown> = {}) {
  await svc.uploadDocument(ctx, subcontractorId, { requirementId, issuedAt: inDays(-10), file: pdf(), ...input });
  const doc = await findDoc(ctx, subcontractorId, requirementId, input);
  await svc.validateDocument(ctx, subcontractorId, doc.id!);
  return doc.id!;
}

async function findDoc(ctx: Ctx, subcontractorId: string, requirementId: string, input: Record<string, unknown> = {}) {
  if (input.workerId) {
    const worker = await workers.getWorker(ctx, input.workerId as string);
    return worker.documents.find((d) => d.requirementId === requirementId)!;
  }
  const detail = await svc.getSubcontractor(ctx, subcontractorId);
  const docs = input.projectId
    ? detail.assignments.filter((a) => a.projectId === input.projectId).map((a) => a.pssAdhesion)
    : detail.documents;
  return docs.find((d) => d.requirementId === requirementId)!;
}

/** Every mandatory company document validated. */
async function makeApta(ctx: Ctx, id: string) {
  for (const req of MANDATORY_COMPANY_REQUIREMENTS) await validDoc(ctx, id, req.id);
}

/** A worker with everything the six access rules ask for. */
async function readyWorker(ctx: Ctx, subcontractorId: string, overrides: Record<string, unknown> = {}) {
  const { id } = await workers.createWorker(ctx, workerInput(subcontractorId, overrides));
  for (const requirementId of ["alta_ss", "tpc", "aptitud_medica", "entrega_epis", "info_riesgos"]) {
    await validDoc(ctx, subcontractorId, requirementId, { workerId: id });
  }
  return id;
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("companies", () => {
  it("creates a company, normalized, with its REA region from the postal code", async () => {
    const { ctx, id } = await setup();

    const detail = await svc.getSubcontractor(ctx, id);
    expect(detail).toMatchObject({
      legalName: "Electricidad Saja S.L.",
      taxId: "B39123450",
      email: "administracion@electricidadsaja.es",
      province: "Cantabria",
      reaRegion: "cantabria",
      status: { status: "pendiente", expired: [] },
      lowPermanentShare: false,
      canManage: true,
    });
    expect(detail.status.pending).toHaveLength(7);
    expect(detail.documents.map((d) => [d.requirementId, d.state]).slice(0, 2)).toEqual([
      ["rea_subcontrata", "missing"],
      ["cert_aeat_contratistas", "missing"],
    ]);
    expect(detail.history).toEqual([expect.objectContaining({ action: "created", userName: "Ana Requejo" })]);
  });

  it.each([
    [{ taxId: "B39123451" }, "invalid_tax_id"],
    [{ kind: "self_employed", taxId: "B39123450" }, "invalid_tax_id"],
    [{ postalCode: "99999" }, "invalid_postal_code"],
    [{ email: "no-at-sign" }, "invalid_email"],
    [{ legalName: " " }, "missing_fields"],
    [{ permanentCount: 10 }, "permanent_exceeds_headcount"],
    [{ kind: "self_employed", taxId: "72145836B", subcontractsFurther: true }, "self_employed_cannot_subcontract"],
    [{ chainLevel: 4 }, "chain_too_deep"],
    [{ chainLevel: 3, subcontractsFurther: true }, "chain_too_deep"],
    [{ trades: ["juggling"] }, "invalid_option"],
    [{ preventionValidUntil: "2026-02-31" }, "invalid_date"],
  ])("rejects %j with %s", async (overrides, code) => {
    const { ctx } = await setup();
    await expect(svc.createSubcontractor(ctx, company({ taxId: "B39654322", ...overrides }))).rejects.toMatchObject({
      code,
    });
  });

  it("registers the wizard's obra and not-applicable documents with the company, all or nothing", async () => {
    const { ctx, tenant } = await setup();
    const project = await createTestProject(tenant.id, { ref: "VTH-26-001" });

    const { id } = await svc.createSubcontractor(
      ctx,
      company({
        taxId: "B39654322",
        assignment: { projectId: project.id, chapterCodes: ["10"], bookOrder: 8, bookDate: "2026-10-28" },
        notApplicable: [{ requirementId: "habilitacion_instalador", reason: "No hace instalaciones" }],
      }),
    );
    const detail = await svc.getSubcontractor(ctx, id);
    expect(detail.assignments).toEqual([expect.objectContaining({ projectRef: "VTH-26-001", chapterCodes: ["10"], bookOrder: 8 })]);
    expect(detail.documents.find((d) => d.requirementId === "habilitacion_instalador")!.state).toBe("not_applicable");
    expect(detail.history.map((h) => h.action).sort()).toEqual(["assigned", "created", "document_not_applicable"]);

    // A mandatory document can't be "No aplica", nor the obra be another tenant's: nothing is created.
    await expect(
      svc.createSubcontractor(ctx, company({ taxId: "B39777719", notApplicable: [{ requirementId: "cert_tgss", reason: "x" }] })),
    ).rejects.toMatchObject({ code: "not_optional" });
    await expect(
      svc.createSubcontractor(ctx, company({ taxId: "B39888821", assignment: { projectId: "nowhere" } })),
    ).rejects.toMatchObject({ code: "project_not_found" });
    expect((await svc.listCompanyOptions(ctx)).map((c) => c.legalName)).toEqual([
      "Electricidad Saja S.L.",
      "Electricidad Saja S.L.",
    ]);
  });

  it("accepts a self-employed worker with a DNI", async () => {
    const { ctx } = await setup();
    await expect(
      svc.createSubcontractor(ctx, company({ kind: "self_employed", legalName: "Javier Ruiz Pellón", taxId: "72145836B" })),
    ).resolves.toEqual({ id: expect.any(String) });
  });

  it("refuses the same CIF twice in a tenant, not across tenants", async () => {
    const { ctx } = await setup();
    await expect(svc.createSubcontractor(ctx, company())).rejects.toMatchObject({ code: "tax_id_exists" });

    const other = await createTestTenant();
    const otherAdmin = await createTestUser(other.id, { role: "admin" });
    await expect(
      svc.createSubcontractor({ tenantId: other.id, userId: otherAdmin.id, role: "admin" }, company()),
    ).resolves.toEqual({ id: expect.any(String) });
  });

  it("updates only what is sent and logs each changed field", async () => {
    const { ctx, id } = await setup();

    await svc.updateSubcontractor(ctx, id, { phone: "942 81 64 21", postalCode: "33001" });
    await svc.updateSubcontractor(ctx, id, { phone: "942 81 64 21" });

    const detail = await svc.getSubcontractor(ctx, id);
    expect(detail).toMatchObject({ phone: "942 81 64 21", legalName: "Electricidad Saja S.L.", reaRegion: "asturias" });
    // The unchanged second update is not logged.
    expect(detail.history.map((h) => h.action)).toEqual(["updated", "created"]);
    expect(detail.history[0]!.detail).toEqual({
      fields: { postalCode: ["39300", "33001"], province: ["Cantabria", "Asturias"], phone: ["942 81 64 20", "942 81 64 21"] },
    });
  });

  it("lets viewers read, with the CIF masked, but not write", async () => {
    const { tenant, id } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const ctx: Ctx = { tenantId: tenant.id, userId: viewer.id, role: "viewer" };

    expect(await svc.getSubcontractor(ctx, id)).toMatchObject({ taxId: "B39•••450", canManage: false });
    await expect(svc.updateSubcontractor(ctx, id, { phone: "600000000" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.createSubcontractor(ctx, company({ taxId: "B39654322" }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.uploadDocument(ctx, id, { requirementId: "cert_tgss", file: pdf() })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("never reaches another tenant's companies", async () => {
    const { id } = await setup();
    const other = await createTestTenant();
    const user = await createTestUser(other.id, { role: "admin" });
    const ctx: Ctx = { tenantId: other.id, userId: user.id, role: "admin" };

    await expect(svc.getSubcontractor(ctx, id)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.updateSubcontractor(ctx, id, { phone: "600000000" })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.uploadDocument(ctx, id, { requirementId: "cert_tgss", file: pdf() })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await svc.listSubcontractors(ctx)).toEqual([]);
    expect((await svc.getOverview(ctx)).companies).toEqual([]);
  });
});

describe("documents", () => {
  it("keeps every upload as a new version and dates the expiry from the issue", async () => {
    const { ctx, id } = await setup();

    await svc.uploadDocument(ctx, id, { requirementId: "cert_aeat_contratistas", issuedAt: "2026-01-10", file: pdf("%PDF-1 v1") });
    const first = await findDoc(ctx, id, "cert_aeat_contratistas");
    await svc.rejectDocument(ctx, id, first.id!, { reason: "Es el certificado genérico" });
    const { version } = await svc.uploadDocument(ctx, id, {
      requirementId: "cert_aeat_contratistas",
      issuedAt: "2026-02-01",
      file: pdf("%PDF-1 v2"),
    });

    expect(version).toBe(2);
    const doc = await findDoc(ctx, id, "cert_aeat_contratistas");
    expect(doc).toMatchObject({ id: first.id, status: "uploaded", issuedAt: "2026-02-01", expiresAt: "2027-02-01" });
    expect(doc.versions.map((v) => [v.version, v.outcome, v.rejectReason])).toEqual([
      [2, null, null],
      [1, "rejected", "Es el certificado genérico"],
    ]);
    // Both files are kept and each still opens.
    expect(files.size).toBe(2);
    const opened = await svc.openDocumentVersion(ctx, id, doc.versions[1]!.id);
    expect(await new Response(opened.body).text()).toBe("%PDF-1 v1");
  });

  it("validates the current version and records who did", async () => {
    const { ctx, id } = await setup();
    await validDoc(ctx, id, "cert_tgss");

    const doc = await findDoc(ctx, id, "cert_tgss");
    expect(doc).toMatchObject({ status: "validated", state: "validated", expiresAt: addMonths(inDays(-10), 1) });
    expect(doc.current).toMatchObject({ outcome: "validated", reviewedBy: "Ana Requejo", uploadedBy: "Ana Requejo" });
    await expect(svc.validateDocument(ctx, id, doc.id!)).rejects.toMatchObject({ code: "nothing_to_review" });
    await expect(svc.rejectDocument(ctx, id, doc.id!, { reason: "x" })).rejects.toMatchObject({
      code: "nothing_to_review",
    });
  });

  it.each([
    [{ requirementId: "nope" }, "invalid_requirement"],
    [{ requirementId: "cert_tgss", file: undefined }, "missing_file"],
    [{ requirementId: "cert_tgss", file: new File(["hello"], "a.pdf") }, "invalid_file_type"],
    [{ requirementId: "cert_tgss", issuedAt: undefined }, "missing_dates"],
    [{ requirementId: "tpc" }, "missing_fields"],
    [{ requirementId: "tpc", workerId: "someone-else" }, "worker_not_found"],
    [{ requirementId: "adhesion_pss", projectId: "nowhere" }, "project_not_found"],
  ])("rejects an upload of %j with %s", async (overrides, code) => {
    const { ctx, id } = await setup();
    const base = { requirementId: "cert_tgss", issuedAt: today, file: pdf() };
    await expect(svc.uploadDocument(ctx, id, { ...base, ...overrides })).rejects.toMatchObject({ code });
  });

  it("needs a reason to reject", async () => {
    const { ctx, id } = await setup();
    await svc.uploadDocument(ctx, id, { requirementId: "evaluacion_riesgos", file: pdf() });
    const doc = await findDoc(ctx, id, "evaluacion_riesgos");
    await expect(svc.rejectDocument(ctx, id, doc.id!, { reason: "" })).rejects.toMatchObject({ code: "missing_reason" });
  });

  it("marks only optional company documents as not applicable", async () => {
    const { ctx, id } = await setup();

    await svc.markNotApplicable(ctx, id, { requirementId: "habilitacion_instalador", reason: "No hace instalaciones" });
    expect(await findDoc(ctx, id, "habilitacion_instalador")).toMatchObject({
      state: "not_applicable",
      notApplicableReason: "No hace instalaciones",
    });
    await expect(svc.markNotApplicable(ctx, id, { requirementId: "cert_tgss", reason: "x" })).rejects.toMatchObject({
      code: "not_optional",
    });
    await expect(svc.markNotApplicable(ctx, id, { requirementId: "doc_maquinaria" })).rejects.toMatchObject({
      code: "missing_reason",
    });
  });

  it("requests documents, then logs a reminder", async () => {
    const { ctx, id } = await setup();

    await svc.requestDocuments(ctx, id, { requirementIds: ["poliza_rc_subcontrata", "evaluacion_riesgos"] });
    await svc.requestDocuments(ctx, id, { requirementIds: ["poliza_rc_subcontrata"] });

    const detail = await svc.getSubcontractor(ctx, id);
    expect(detail.documents.find((d) => d.requirementId === "poliza_rc_subcontrata")).toMatchObject({
      state: "requested",
      requestedAt: expect.any(String),
    });
    expect(detail.history.map((h) => h.action).slice(0, 3)).toEqual([
      "document_reminded",
      "document_requested",
      "document_requested",
    ]);
  });

  it("logs every document action", async () => {
    const { ctx, id } = await setup();
    await validDoc(ctx, id, "cert_tgss");

    const rows = await db.select().from(subcontractorAudit).where(eq(subcontractorAudit.subcontractorId, id));
    expect(rows.map((r) => r.action).sort()).toEqual(["created", "document_uploaded", "document_validated"]);
    expect(rows.find((r) => r.action === "document_validated")!.detail).toMatchObject({
      requirementId: "cert_tgss",
      version: 1,
    });
  });

  it("doesn't open another company's version", async () => {
    const { ctx, id } = await setup();
    await svc.uploadDocument(ctx, id, { requirementId: "evaluacion_riesgos", file: pdf() });
    const [version] = await db.select().from(subcontractorDocumentVersions);
    const { id: otherId } = await svc.createSubcontractor(ctx, company({ taxId: "B39654322" }));

    await expect(svc.openDocumentVersion(ctx, otherId, version!.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("status", () => {
  it("is apta with every mandatory document validated, and bloqueada once one expires", async () => {
    const { ctx, id } = await setup();
    await makeApta(ctx, id);
    expect((await svc.getSubcontractor(ctx, id)).status).toEqual({ status: "apta", expired: [], pending: [] });

    // A company whose validated AEAT certificate has run out.
    const { id: lapsed } = await svc.createSubcontractor(ctx, company({ taxId: "B39654322" }));
    await makeApta(ctx, lapsed);
    await svc.uploadDocument(ctx, lapsed, {
      requirementId: "cert_aeat_contratistas",
      issuedAt: inDays(-400),
      expiresAt: inDays(-1),
      file: pdf(),
    });
    await svc.validateDocument(ctx, lapsed, (await findDoc(ctx, lapsed, "cert_aeat_contratistas")).id!);
    const detail = await svc.getSubcontractor(ctx, lapsed);
    expect(detail.status).toMatchObject({ status: "bloqueada", expired: ["cert_aeat_contratistas"] });
    expect(detail.history).toContainEqual(
      expect.objectContaining({ action: "document_expired", detail: { requirementId: "cert_aeat_contratistas", affectedWorkers: 0 } }),
    );
  });
});

describe("workers", () => {
  it("creates a worker with a checked DNI, unique in the tenant", async () => {
    const { ctx, id } = await setup();
    const { id: workerId } = await workers.createWorker(ctx, workerInput(id));

    expect(await workers.getWorker(ctx, workerId)).toMatchObject({
      idDocument: "72145836B",
      subcontractorName: "Electricidad Saja S.L.",
      companyStatus: "pendiente",
      access: { status: "pending" },
    });
    await expect(workers.createWorker(ctx, workerInput(id))).rejects.toMatchObject({ code: "id_document_exists" });
    await expect(workers.createWorker(ctx, workerInput(id, { idDocument: "72145836C" }))).rejects.toMatchObject({
      code: "invalid_id_document",
    });
    await expect(workers.createWorker(ctx, workerInput("nope", { idDocument: "X1234567L" }))).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("has access once the company is apta and their own documents are in order", async () => {
    const { ctx, id } = await setup();
    const workerId = await readyWorker(ctx, id);
    expect((await workers.getWorker(ctx, workerId)).access.status).toBe("pending");

    await makeApta(ctx, id);
    expect((await workers.getWorker(ctx, workerId)).access).toMatchObject({ status: "ok" });
    expect((await workers.listWorkers(ctx))[0]).toMatchObject({ id: workerId, access: { status: "ok" } });
  });

  it("needs the training of the chapters their company does on the obra", async () => {
    const { ctx, id, tenant } = await setup();
    await makeApta(ctx, id);
    const workerId = await readyWorker(ctx, id);
    const project = await createTestProject(tenant.id);
    await svc.assignToProject(ctx, id, project.id, { chapterCodes: ["05"], bookOrder: 7, bookDate: today });

    const [onObra] = await workers.listWorkers(ctx, { projectId: project.id });
    expect(onObra!.access.status).toBe("pending");
    expect(onObra!.access.checks.filter((c) => !c.ok).map((c) => c.reasons)).toEqual([
      [{ code: "missing", requirementId: "adhesion_pss" }],
      [{ code: "missing", requirementId: "formacion_altura" }],
    ]);

    await validDoc(ctx, id, "adhesion_pss", { projectId: project.id });
    await validDoc(ctx, id, "formacion_altura", { workerId });
    expect((await workers.listWorkers(ctx, { projectId: project.id }))[0]!.access.status).toBe("ok");
    expect((await workers.getWorker(ctx, workerId)).obras).toEqual([
      expect.objectContaining({ projectId: project.id, chapterCodes: ["05"], bookEntry: true, access: expect.objectContaining({ status: "ok" }) }),
    ]);
  });

  it("checks access by DNI or TPC number", async () => {
    const { ctx, id, tenant } = await setup();
    await makeApta(ctx, id);
    await readyWorker(ctx, id);
    const project = await createTestProject(tenant.id);

    expect(await workers.checkAccess(ctx, { query: "72145836-b" })).toMatchObject({
      worker: { name: "Iván Gómez Ruiz", subcontractorName: "Electricidad Saja S.L." },
      access: { status: "ok" },
    });
    expect((await workers.checkAccess(ctx, { query: "39-0123456" })).worker).not.toBeNull();
    // Not assigned to this obra: no PSS adhesion or book entry for it.
    expect((await workers.checkAccess(ctx, { query: "72145836B", projectId: project.id })).access!.status).toBe(
      "pending",
    );
    expect(await workers.checkAccess(ctx, { query: "00000000T" })).toEqual({ worker: null, access: null });
  });

  it("logs edits and moves the worker's documents with them", async () => {
    const { ctx, id } = await setup();
    const workerId = await readyWorker(ctx, id);
    const { id: otherId } = await svc.createSubcontractor(ctx, company({ taxId: "B39654322", legalName: "Otra S.L." }));

    await workers.updateWorker(ctx, workerId, { subcontractorId: otherId, roles: ["preventive_resource"] });

    const worker = await workers.getWorker(ctx, workerId);
    expect(worker).toMatchObject({ subcontractorName: "Otra S.L.", roles: ["preventive_resource"] });
    expect(worker.documents.find((d) => d.requirementId === "alta_ss")!.state).toBe("validated");
    const history = (await svc.getSubcontractor(ctx, otherId)).history;
    expect(history[0]).toMatchObject({ action: "worker_updated", workerName: "Iván Gómez Ruiz" });
  });

  it("masks the DNI for viewers and stays inside the tenant", async () => {
    const { ctx, id, tenant } = await setup();
    const { id: workerId } = await workers.createWorker(ctx, workerInput(id));
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const viewerCtx: Ctx = { tenantId: tenant.id, userId: viewer.id, role: "viewer" };

    expect((await workers.getWorker(viewerCtx, workerId)).idDocument).toBe("72•••836B");
    await expect(workers.updateWorker(viewerCtx, workerId, { phone: "600000000" })).rejects.toMatchObject({
      code: "forbidden",
    });

    const other = await createTestTenant();
    const user = await createTestUser(other.id, { role: "admin" });
    const otherCtx: Ctx = { tenantId: other.id, userId: user.id, role: "admin" };
    await expect(workers.getWorker(otherCtx, workerId)).rejects.toMatchObject({ code: "worker_not_found" });
    expect(await workers.listWorkers(otherCtx)).toEqual([]);
    expect(await workers.checkAccess(otherCtx, { query: "72145836B" })).toEqual({ worker: null, access: null });
  });
});

describe("assignments", () => {
  it("assigns a company to an obra and updates it in place", async () => {
    const { ctx, id, tenant } = await setup();
    const project = await createTestProject(tenant.id, { ref: "VTH-26-001" });

    await svc.assignToProject(ctx, id, project.id, { chapterCodes: ["14", "13", "13"], plannedStart: "2026-10-05" });
    await svc.assignToProject(ctx, id, project.id, { chapterCodes: "13,14", cssInformed: true, bookOrder: "7", bookDate: "2026-09-20" });

    const [assignment] = (await svc.getSubcontractor(ctx, id)).assignments;
    expect(assignment).toMatchObject({
      projectRef: "VTH-26-001",
      chapterCodes: ["13", "14"],
      plannedStart: null,
      bookOrder: 7,
      cssInformed: true,
      pssAdhesion: { state: "missing" },
    });
    await expect(svc.assignToProject(ctx, id, project.id, { chapterCodes: ["99"] })).rejects.toMatchObject({
      code: "invalid_chapter",
    });
    await expect(
      svc.assignToProject(ctx, id, project.id, { plannedStart: "2026-12-01", plannedEnd: "2026-11-01" }),
    ).rejects.toMatchObject({ code: "invalid_date" });

    await svc.removeAssignment(ctx, id, project.id);
    expect((await svc.getSubcontractor(ctx, id)).assignments).toEqual([]);
  });

  it("only assigns to the tenant's own projects", async () => {
    const { ctx, id } = await setup();
    const other = await createTestTenant();
    const project = await createTestProject(other.id);
    await expect(svc.assignToProject(ctx, id, project.id, {})).rejects.toMatchObject({ code: "project_not_found" });
  });
});

/** The company's assignment rows as stored, removed ones too. */
const storedAssignments = (subcontractorId: string) =>
  db.select().from(subcontractorAssignments).where(eq(subcontractorAssignments.subcontractorId, subcontractorId));

const auditActions = async (subcontractorId: string) =>
  (await db.select().from(subcontractorAudit).where(eq(subcontractorAudit.subcontractorId, subcontractorId)))
    .map((r) => r.action)
    .sort();

/**
 * An apta company with a worker ready to enter, on an obra in execution, its
 * PSS adhesion there validated and about to expire (so it counts everywhere).
 */
async function onObra() {
  const base = await setup();
  const { ctx, id, tenant } = base;
  await makeApta(ctx, id);
  const workerId = await readyWorker(ctx, id);
  const project = await createTestProject(tenant.id, { ref: "VTH-26-001" });
  await db.update(projects).set({ obraStage: 6 }).where(eq(projects.id, project.id));
  await svc.assignToProject(ctx, id, project.id, { chapterCodes: ["13"], bookOrder: 7, bookDate: today });
  await validDoc(ctx, id, "adhesion_pss", { projectId: project.id, expiresAt: inDays(5) });
  return { ...base, project, workerId };
}

/** Everything the portal reads about the company on that obra. */
async function seenOnObra(ctx: Ctx, id: string, projectId: string, workerId: string) {
  const overview = await svc.getOverview(ctx);
  return {
    assignments: (await svc.getSubcontractor(ctx, id)).assignments.map((a) => a.projectId),
    listed: (await svc.listSubcontractors(ctx)).find((c) => c.id === id)!.projectIds,
    onSiteToday: overview.onSiteToday,
    expiring: overview.expiring,
    expiries: (await svc.getCounts(ctx)).expiries,
    attention: overview.attention.filter((a) => a.projectId === projectId).length,
    projectAttention: (await svc.listProjectAttention(ctx, projectId)).length,
    workersOnObra: (await workers.listWorkers(ctx, { projectId })).length,
    workerObras: (await workers.getWorker(ctx, workerId)).obras.length,
    accessOnObra: await workers.checkAccess(ctx, { query: "72145836B", projectId }).then(
      (check) => check.access!.status,
      (error: { code: string }) => error.code,
    ),
    accessAnywhere: (await workers.checkAccess(ctx, { query: "72145836B" })).access!.status,
  };
}

/** The obra's PSS adhesion can't be reviewed or opened by its id either. */
async function expectAdhesionGone(ctx: Ctx, id: string, documentId: string, versionId: string) {
  const notFound = { code: "not_found", status: 404 };
  await expect(svc.validateDocument(ctx, id, documentId)).rejects.toMatchObject(notFound);
  await expect(svc.rejectDocument(ctx, id, documentId, { reason: "x" })).rejects.toMatchObject(notFound);
  await expect(svc.openDocumentVersion(ctx, id, versionId)).rejects.toMatchObject(notFound);
}

const GONE = {
  assignments: [],
  listed: [],
  onSiteToday: { projectRefs: [], companies: 0, workers: 0, blocked: [] },
  expiring: 0,
  expiries: 0,
  attention: 0,
  projectAttention: 0,
  workersOnObra: 0,
  workerObras: 0,
  // The obra's own checks fail, as on any obra the company isn't on.
  accessOnObra: "pending",
  accessAnywhere: "ok",
};

describe("removing a company from an obra", () => {
  it("keeps the assignment, marked with who removed it and when, and logs it", async () => {
    const { ctx, id, admin, project } = await onObra();
    const [before] = await storedAssignments(id);

    await svc.removeAssignment(ctx, id, project.id);

    const rows = await storedAssignments(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: before!.id,
      deletedAt: expect.any(Date),
      deletedById: admin.id,
      // The Libro de Subcontratación entry stays as it was.
      chapterCodes: ["13"],
      bookOrder: 7,
      bookDate: today,
    });
    const log = await db.select().from(subcontractorAudit).where(eq(subcontractorAudit.subcontractorId, id));
    expect(log.filter((r) => r.action === "unassigned")).toEqual([
      expect.objectContaining({ userId: admin.id, detail: { projectId: project.id } }),
    ]);

    // Already removed: there is nothing to remove, and nothing more is logged.
    await expect(svc.removeAssignment(ctx, id, project.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect((await auditActions(id)).filter((a) => a === "unassigned")).toHaveLength(1);
    expect((await storedAssignments(id))[0]!.deletedAt).toEqual(rows[0]!.deletedAt);
  });

  it("removes and logs in one transaction: neither stays if the log fails", async () => {
    const { ctx, id, project } = await onObra();
    await db.execute(
      sql`alter table subcontractor_audit add constraint test_no_unassigned check (action <> 'unassigned') not valid`,
    );
    try {
      await expect(svc.removeAssignment(ctx, id, project.id)).rejects.toThrow();
    } finally {
      await db.execute(sql`alter table subcontractor_audit drop constraint test_no_unassigned`);
    }

    expect((await storedAssignments(id))[0]).toMatchObject({ deletedAt: null, deletedById: null });
    expect(await auditActions(id)).not.toContain("unassigned");
    expect((await svc.getSubcontractor(ctx, id)).assignments).toHaveLength(1);
  });

  it("takes no obra document for a company that is no longer on that obra", async () => {
    const { ctx, id, project } = await onObra();
    await svc.removeAssignment(ctx, id, project.id);

    // No read would show it: better refused than stored and hidden.
    const upload = svc.uploadDocument(ctx, id, { requirementId: "adhesion_pss", projectId: project.id, file: pdf() });
    await expect(upload).rejects.toMatchObject({ code: "project_not_found" });

    await svc.assignToProject(ctx, id, project.id, { chapterCodes: ["05"] });
    await svc.uploadDocument(ctx, id, { requirementId: "adhesion_pss", projectId: project.id, file: pdf() });
  });

  it("leaves it out of every read, as if it had never been there", async () => {
    const { ctx, id, project, workerId } = await onObra();
    expect(await seenOnObra(ctx, id, project.id, workerId)).toEqual({
      assignments: [project.id],
      listed: [project.id],
      onSiteToday: { projectRefs: ["VTH-26-001"], companies: 1, workers: 1, blocked: [] },
      expiring: 1,
      expiries: 1,
      attention: 1,
      projectAttention: 1,
      workersOnObra: 1,
      workerObras: 1,
      accessOnObra: "ok",
      accessAnywhere: "ok",
    });

    const adhesion = await findDoc(ctx, id, "adhesion_pss", { projectId: project.id });

    await svc.removeAssignment(ctx, id, project.id);

    expect(await seenOnObra(ctx, id, project.id, workerId)).toEqual(GONE);
    await expectAdhesionGone(ctx, id, adhesion.id!, adhesion.current!.id);
    // The obra is still there to assign to; its dossier no longer has the company.
    expect((await svc.listProjectOptions(ctx)).map((p) => p.id)).toEqual([project.id]);
    const dossier = await svc.exportDossier(ctx, { projectId: project.id });
    const zip = unzipSync(new Uint8Array(await new Response(dossier.body).arrayBuffer()));
    expect(Object.keys(zip)).toEqual(["indice.csv"]);
    expect(strFromU8(zip["indice.csv"]!)).not.toContain("Electricidad Saja");
    // With no obra left, the company may become a material supplier.
    const { id: bare } = await svc.createSubcontractor(ctx, company({ taxId: "B39654322" }));
    await svc.assignToProject(ctx, bare, project.id, {});
    await expect(svc.updateSubcontractor(ctx, bare, { suppliesOnly: true })).rejects.toMatchObject({ code: "supplies_only" });
    await svc.removeAssignment(ctx, bare, project.id);
    await expect(svc.updateSubcontractor(ctx, bare, { suppliesOnly: true })).resolves.toEqual({ id: bare });
  });

  it("is not for viewers, nor for another tenant", async () => {
    const { ctx, id, tenant, project } = await onObra();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const other = await createTestTenant();
    const stranger = await createTestUser(other.id, { role: "admin" });

    await expect(
      svc.removeAssignment({ tenantId: tenant.id, userId: viewer.id, role: "viewer" }, id, project.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      svc.removeAssignment({ tenantId: other.id, userId: stranger.id, role: "admin" }, id, project.id),
    ).rejects.toMatchObject({ code: "not_found" });

    expect((await storedAssignments(id))[0]).toMatchObject({ deletedAt: null, deletedById: null });
    expect(await auditActions(id)).not.toContain("unassigned");
    expect((await svc.getSubcontractor(ctx, id)).assignments).toHaveLength(1);
  });

  it("takes the removed row back when the company is assigned again, as a new assignment", async () => {
    const { ctx, id, project } = await onObra();
    await svc.assignToProject(ctx, id, project.id, {
      chapterCodes: ["13"],
      plannedStart: "2026-10-05",
      plannedEnd: "2026-11-20",
      bookOrder: 7,
      bookDate: today,
      cssInformed: true,
    });
    const [before] = await storedAssignments(id);
    const adhesion = await findDoc(ctx, id, "adhesion_pss", { projectId: project.id });
    await svc.removeAssignment(ctx, id, project.id);

    await expect(svc.assignToProject(ctx, id, project.id, { chapterCodes: ["05"] })).resolves.toEqual({
      subcontractorId: id,
      projectId: project.id,
    });

    // The same row (one per company and obra), with only what was sent now.
    const rows = await storedAssignments(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: before!.id,
      deletedAt: null,
      deletedById: null,
      chapterCodes: ["05"],
      plannedStart: null,
      plannedEnd: null,
      bookOrder: null,
      bookDate: null,
      cssInformed: false,
    });
    const [assignment] = (await svc.getSubcontractor(ctx, id)).assignments;
    // The obra's documents are the company's there: the adhesion it had shows again.
    expect(assignment).toMatchObject({
      projectId: project.id,
      chapterCodes: ["05"],
      bookOrder: null,
      pssAdhesion: { id: adhesion.id, state: "expiring" },
    });
    await expect(svc.openDocumentVersion(ctx, id, adhesion.current!.id)).resolves.toMatchObject({ filename: "certificado.pdf" });
    expect((await auditActions(id)).filter((a) => a.endsWith("assigned"))).toEqual([
      "assigned",
      "assigned",
      "assigned",
      "unassigned",
    ]);

    // Removed and assigned twice at once: still one row, never a unique violation.
    await svc.removeAssignment(ctx, id, project.id);
    await Promise.all([
      svc.assignToProject(ctx, id, project.id, { chapterCodes: ["14"] }),
      svc.assignToProject(ctx, id, project.id, { chapterCodes: ["14"] }),
    ]);
    expect(await storedAssignments(id)).toEqual([
      expect.objectContaining({ id: before!.id, deletedAt: null, chapterCodes: ["14"] }),
    ]);
  });
});

describe("a deleted obra", () => {
  it("takes its assignments out of every read and can't be assigned to", async () => {
    const { ctx, id, admin, project, workerId, tenant } = await onObra();
    const kept = await createTestProject(tenant.id, { ref: "VTH-26-002" });
    const adhesion = await findDoc(ctx, id, "adhesion_pss", { projectId: project.id });

    await db.update(projects).set({ deletedAt: new Date(), deletedById: admin.id }).where(eq(projects.id, project.id));

    // A check at the gate of an obra that is gone says so, whoever the worker.
    expect(await seenOnObra(ctx, id, project.id, workerId)).toEqual({ ...GONE, accessOnObra: "project_not_found" });
    await expect(workers.checkAccess(ctx, { query: "00000000T", projectId: project.id })).rejects.toMatchObject({
      code: "project_not_found",
    });
    await expectAdhesionGone(ctx, id, adhesion.id!, adhesion.current!.id);
    // The assignment itself was never removed.
    expect((await storedAssignments(id))[0]).toMatchObject({ projectId: project.id, deletedAt: null });

    // Not an obra to choose any more: in the lists, the dossier or a new assignment.
    expect((await svc.listProjectOptions(ctx)).map((p) => p.ref)).toEqual(["VTH-26-002"]);
    expect((await svc.getOverview(ctx)).projects.map((p) => p.ref)).toEqual(["VTH-26-002"]);
    const notFound = { code: "project_not_found", status: 404 };
    await expect(svc.exportDossier(ctx, { projectId: project.id })).rejects.toMatchObject(notFound);
    await expect(svc.assignToProject(ctx, id, project.id, { chapterCodes: ["05"] })).rejects.toMatchObject(notFound);
    await expect(
      svc.createSubcontractor(ctx, company({ taxId: "B39654322", assignment: { projectId: project.id } })),
    ).rejects.toMatchObject(notFound);
    await expect(
      svc.uploadDocument(ctx, id, { requirementId: "adhesion_pss", projectId: project.id, file: pdf() }),
    ).rejects.toMatchObject(notFound);
    await expect(
      svc.requestDocuments(ctx, id, { requirementIds: ["adhesion_pss"], projectId: project.id }),
    ).rejects.toMatchObject(notFound);
    await expect(svc.removeAssignment(ctx, id, project.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await storedAssignments(id))[0]).toMatchObject({ chapterCodes: ["13"], deletedAt: null });

    // The other obra works as ever.
    await svc.assignToProject(ctx, id, kept.id, {});
    expect((await svc.getSubcontractor(ctx, id)).assignments.map((a) => a.projectRef)).toEqual(["VTH-26-002"]);
  });
});

describe("material suppliers", () => {
  const supplier = () => company({ legalName: "Piedra de Liébana S.L.", taxId: "B39654322", suppliesOnly: true });

  it("are apta with no CAE: no documents asked, nothing to attend to", async () => {
    const { ctx } = await setup();
    const { id } = await svc.createSubcontractor(ctx, supplier());

    const overview = await svc.getOverview(ctx);
    expect(overview.companies.find((c) => c.id === id)).toMatchObject({ suppliesOnly: true, status: "apta", docsTotal: 0, docsValid: 0 });
    expect(overview.attention.some((a) => a.subcontractorId === id)).toBe(false);
    // The subcontractor of setup() still counts as pending; the supplier counts nowhere.
    expect(overview.counts).toEqual({ apta: 0, pendiente: 1, bloqueada: 0 });
    expect((await svc.getSubcontractor(ctx, id)).suppliesOnly).toBe(true);
  });

  it("have no workers, obras or documents", async () => {
    const { ctx, tenant } = await setup();
    const { id } = await svc.createSubcontractor(ctx, supplier());
    const project = await createTestProject(tenant.id);

    await expect(workers.createWorker(ctx, workerInput(id))).rejects.toMatchObject({ code: "supplies_only" });
    await expect(svc.assignToProject(ctx, id, project.id, {})).rejects.toMatchObject({ code: "supplies_only" });
    await expect(svc.requestDocuments(ctx, id, { requirementIds: ["cert_tgss"] })).rejects.toMatchObject({ code: "supplies_only" });
    await expect(
      svc.uploadDocument(ctx, id, { requirementId: "cert_tgss", issuedAt: inDays(-1), file: pdf() }),
    ).rejects.toMatchObject({ code: "supplies_only" });
    await expect(
      svc.createSubcontractor(ctx, company({ taxId: "B39777719", suppliesOnly: true, assignment: { projectId: project.id } })),
    ).rejects.toMatchObject({ code: "supplies_only" });
  });

  it("can't be a company that already has workers or obras", async () => {
    const { ctx, id } = await setup();
    await workers.createWorker(ctx, workerInput(id));
    await expect(svc.updateSubcontractor(ctx, id, { suppliesOnly: true })).rejects.toMatchObject({ code: "supplies_only" });

    const { id: plain } = await svc.createSubcontractor(ctx, company({ taxId: "B39777719" }));
    await svc.updateSubcontractor(ctx, plain, { suppliesOnly: true });
    expect((await svc.getSubcontractor(ctx, plain)).suppliesOnly).toBe(true);
  });
});

describe("overview", () => {
  it("counts statuses, access, expiries and who is on site today", async () => {
    const { ctx, id, tenant } = await setup();
    await makeApta(ctx, id);
    await readyWorker(ctx, id);
    // Expiring in 18 days.
    await svc.uploadDocument(ctx, id, {
      requirementId: "poliza_rc_subcontrata",
      issuedAt: inDays(-300),
      expiresAt: inDays(18),
      file: pdf(),
    });
    await svc.validateDocument(ctx, id, (await findDoc(ctx, id, "poliza_rc_subcontrata")).id!);
    const { id: pendingId } = await svc.createSubcontractor(ctx, company({ taxId: "B39654322", legalName: "Aislamientos Cantábrico S.L." }));
    await svc.uploadDocument(ctx, pendingId, { requirementId: "evaluacion_riesgos", file: pdf() });
    const project = await createTestProject(tenant.id, { ref: "VTH-26-001" });
    await db.update(projects).set({ obraStage: 6 }).where(eq(projects.id, project.id));
    await svc.assignToProject(ctx, id, project.id, { chapterCodes: ["13"], bookOrder: 7, bookDate: today });
    await validDoc(ctx, id, "adhesion_pss", { projectId: project.id });

    const overview = await svc.getOverview(ctx);
    expect(overview.counts).toEqual({ apta: 1, pendiente: 1, bloqueada: 0 });
    expect(overview.workers).toEqual({ total: 1, ok: 1, pending: 0, blocked: 0 });
    expect(overview.expiring).toBe(1);
    expect(overview.onSiteToday).toEqual({ projectRefs: ["VTH-26-001"], companies: 1, workers: 1, blocked: [] });
    expect(overview.companies.find((c) => c.id === id)).toMatchObject({
      status: "apta",
      docsValid: 7,
      docsTotal: 7,
      workers: 1,
      pillars: { rc: { state: "expiring", daysLeft: 18 }, aeat: { state: "validated" } },
      projectIds: [project.id],
    });
    expect(overview.attention.map((a) => [a.subcontractorName, a.state, a.requirementIds.length])).toEqual([
      ["Aislamientos Cantábrico S.L.", "missing", 6],
      ["Aislamientos Cantábrico S.L.", "uploaded", 1],
      ["Electricidad Saja S.L.", "expiring", 1],
    ]);
    expect(overview.projects[0]).toMatchObject({ ref: "VTH-26-001", chapters: expect.arrayContaining([{ code: "05", name: expect.any(String) }]) });
    expect(await svc.getCounts(ctx)).toEqual({ companies: 2, workers: 1, expiries: 1 });
  });
});

describe("dossier", () => {
  it("zips the valid documents of the companies on an obra, with an index", async () => {
    const { ctx, id, tenant } = await setup();
    await validDoc(ctx, id, "rea_subcontrata");
    await svc.uploadDocument(ctx, id, { requirementId: "evaluacion_riesgos", file: pdf("%PDF-1 pending") });
    const workerId = (await workers.createWorker(ctx, workerInput(id))).id;
    await validDoc(ctx, id, "alta_ss", { workerId });
    const project = await createTestProject(tenant.id, { ref: "VTH-26-001" });
    await svc.assignToProject(ctx, id, project.id, {});
    await svc.createSubcontractor(ctx, company({ taxId: "B39654322", legalName: "Fuera de obra S.L." }));

    const dossier = await svc.exportDossier(ctx, { projectId: project.id });
    expect(dossier.filename).toBe(`dossier-cae-VTH-26-001-${today}.zip`);
    const zip = unzipSync(new Uint8Array(await new Response(dossier.body).arrayBuffer()));

    expect(Object.keys(zip).sort()).toEqual([
      "Electricidad Saja S.L. (B39123450)/empresa/rea_subcontrata_v1.pdf",
      "Electricidad Saja S.L. (B39123450)/trabajadores/Gómez Ruiz, Iván (72145836B)/alta_ss_v1.pdf",
      "indice.csv",
    ]);
    const index = strFromU8(zip["indice.csv"]!);
    expect(index).toContain('"evaluacion_riesgos";"uploaded"');
    expect(index).not.toContain("Fuera de obra");
  });
});

describe("seed", () => {
  it("gives the dev project companies in every state, once", async () => {
    const { seedSubcontractors } = await import("../src/seed/subcontractors");
    const tenant = await createTestTenant();
    const admin = await createTestUser(tenant.id, { role: "admin" });
    const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
    const project = await createTestProject(tenant.id, { ref: "VTH-26-001" });
    await db.update(projects).set({ obraStage: 6 }).where(eq(projects.id, project.id));

    expect(await seedSubcontractors(ctx, project.id, { files: true })).toBe(8);
    expect(await seedSubcontractors(ctx, project.id, { files: true })).toBe(0);

    const overview = await svc.getOverview(ctx);
    expect(overview.counts).toEqual({ apta: 4, pendiente: 3, bloqueada: 1 });
    expect(overview.workers.total).toBe(12);
    expect(overview.workers.blocked).toBeGreaterThan(0);
    expect(overview.workers.ok).toBeGreaterThan(0);
    expect(overview.expiring).toBeGreaterThanOrEqual(3);
    expect(overview.expired).toBeGreaterThanOrEqual(2);
    expect(overview.onSiteToday.companies).toBeGreaterThan(0);
    expect(overview.onSiteToday.blocked).toEqual(["Electricidad Saja S.L."]);
    const states = new Set(overview.attention.map((a) => a.state));
    expect([...states].sort()).toEqual(["expired", "expiring", "missing", "requested", "uploaded"]);
  });
});

describe("code review fixes", () => {
  it("keeps a company apta while a renewal awaits validation or is rejected", async () => {
    const { ctx, id } = await setup();
    await makeApta(ctx, id);

    await svc.uploadDocument(ctx, id, { requirementId: "cert_tgss", issuedAt: today, file: pdf("%PDF-1 renewal") });
    let detail = await svc.getSubcontractor(ctx, id);
    expect(detail.status.status).toBe("apta");
    expect(detail.documents.find((d) => d.requirementId === "cert_tgss")!.state).toBe("uploaded");

    const doc = detail.documents.find((d) => d.requirementId === "cert_tgss")!;
    await svc.rejectDocument(ctx, id, doc.id!, { reason: "Ilegible" });
    detail = await svc.getSubcontractor(ctx, id);
    expect(detail.status.status).toBe("apta");
    expect((await svc.getOverview(ctx)).attention.map((a) => a.state)).toContain("rejected");
  });

  it("numbers concurrent uploads of one document one after the other", async () => {
    const { ctx, id } = await setup();
    const results = await Promise.all(
      [1, 2, 3].map(() => svc.uploadDocument(ctx, id, { requirementId: "evaluacion_riesgos", file: pdf() })),
    );
    expect(results.map((r) => r.version).sort()).toEqual([1, 2, 3]);
  });

  it("takes the province from a new postal code", async () => {
    const { ctx, id } = await setup();
    await svc.updateSubcontractor(ctx, id, { postalCode: "08001" });
    expect(await svc.getSubcontractor(ctx, id)).toMatchObject({ province: "Barcelona", reaRegion: "cataluna" });
  });

  it("keeps the dossier from viewers", async () => {
    const { tenant } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    await expect(
      svc.exportDossier({ tenantId: tenant.id, userId: viewer.id, role: "viewer" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("counts a worker on two obras today once", async () => {
    const { ctx, id, tenant } = await setup();
    await makeApta(ctx, id);
    await readyWorker(ctx, id);
    for (const ref of ["VTH-26-001", "VTH-26-002"]) {
      const project = await createTestProject(tenant.id, { ref });
      await db.update(projects).set({ obraStage: 6 }).where(eq(projects.id, project.id));
      await svc.assignToProject(ctx, id, project.id, { bookOrder: 1, bookDate: today });
      await validDoc(ctx, id, "adhesion_pss", { projectId: project.id });
    }
    expect((await svc.getOverview(ctx)).onSiteToday).toMatchObject({ companies: 1, workers: 1 });
  });

  it("collapses repeated not-applicable entries instead of reporting a taken CIF", async () => {
    const { ctx } = await setup();
    const entry = { requirementId: "escrituras_036", reason: "x" };
    await expect(
      svc.createSubcontractor(ctx, company({ taxId: "B39654322", notApplicable: [entry, { ...entry, reason: "y" }] })),
    ).resolves.toEqual({ id: expect.any(String) });
  });
});
