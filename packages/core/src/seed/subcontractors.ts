import {
  db,
  eq,
  subcontractorAudit,
  subcontractorDocumentVersions,
  subcontractorDocuments,
  subcontractors,
} from "@repo/db";
import type { Ctx } from "../context";
import {
  MANDATORY_COMPANY_REQUIREMENTS,
  addMonths,
  isValidCif,
  isValidDni,
  requirement,
  type RequirementId,
} from "../contract";
import { addDays, todayInSpain } from "../obra-calc";
import { putFile } from "../storage";
import { assignToProject, createSubcontractor } from "../subcontractors";
import { createWorker } from "../subcontractor-workers";

// `pnpm db:seed`: fictional subcontractors for the dev project VTH-26-001, in
// every state the Subcontratas pages show (apta, pendiente, bloqueada;
// documents expiring, expired, awaiting validation, requested). Dates are
// relative to today so the states stay true whenever it runs. Without a Blob
// store (`files: false`) the versions are recorded without their PDFs.

const today = todayInSpain();
const day = (offset: number) => addDays(today, offset);

/** A CIF with its control digit: the first one `isValidCif` accepts. */
const cif = (stem: string) => [..."0123456789"].map((c) => stem + c).find(isValidCif)!;
const dni = (digits: string) => [..."TRWAGMYFPDXBNJZSQVHLCKE"].map((l) => digits + l).find(isValidDni)!;

type DocSeed = {
  requirementId: RequirementId;
  state?: "validated" | "uploaded" | "requested" | "rejected";
  /** Days from today; the issue date follows from the requirement's validity. */
  expiresIn?: number | null;
  workerId?: string;
  projectId?: string;
};

async function seedDoc(ctx: Ctx, subcontractorId: string, seed: DocSeed, files: boolean) {
  const state = seed.state ?? "validated";
  const [doc] = await db
    .insert(subcontractorDocuments)
    .values({
      tenantId: ctx.tenantId,
      subcontractorId,
      workerId: seed.workerId ?? null,
      projectId: seed.projectId ?? null,
      requirementId: seed.requirementId,
      status: state,
      requestedAt: state === "requested" ? new Date(`${day(-9)}T09:00:00Z`) : null,
    })
    .returning({ id: subcontractorDocuments.id });
  const detail = { requirementId: seed.requirementId, version: 1, projectId: seed.projectId ?? null };
  const workerId = seed.workerId ?? null;
  if (state === "requested") {
    await db.insert(subcontractorAudit).values({
      tenantId: ctx.tenantId,
      subcontractorId,
      workerId,
      userId: ctx.userId,
      action: "document_requested",
      detail,
      createdAt: new Date(`${day(-9)}T09:00:00Z`),
    });
    return;
  }

  const expiresAt = seed.expiresIn === undefined || seed.expiresIn === null ? null : day(seed.expiresIn);
  const months = requirement(seed.requirementId)?.validityMonths;
  // Issued one validity period before it expires.
  const issuedAt = expiresAt && months ? addMonths(expiresAt, -months) : day(-60);
  const id = crypto.randomUUID();
  const pathname = `tenants/${ctx.tenantId}/subcontractors/${subcontractorId}/${id}.pdf`;
  if (files) {
    await putFile(pathname, new Blob([`%PDF-1.4\n% ${seed.requirementId}\n`]), "application/pdf");
  }
  const uploadedAt = new Date(`${issuedAt}T10:00:00Z`);
  const reviewedAt = new Date(`${issuedAt}T16:30:00Z`);
  const reviewed = state === "validated" || state === "rejected";
  await db.insert(subcontractorDocumentVersions).values({
    id,
    tenantId: ctx.tenantId,
    documentId: doc!.id,
    version: 1,
    pathname,
    filename: `${seed.requirementId}.pdf`,
    sizeBytes: 64,
    issuedAt,
    expiresAt,
    uploadedById: ctx.userId,
    reviewedById: reviewed ? ctx.userId : null,
    reviewedAt: reviewed ? reviewedAt : null,
    rejectReason: state === "rejected" ? "Ilegible: vuelve a escanearlo" : null,
    createdAt: uploadedAt,
  });
  await db.insert(subcontractorAudit).values([
    { tenantId: ctx.tenantId, subcontractorId, workerId, userId: ctx.userId, action: "document_uploaded", detail, createdAt: uploadedAt },
    ...(reviewed
      ? [
          {
            tenantId: ctx.tenantId,
            subcontractorId,
            workerId,
            userId: ctx.userId,
            action: state === "validated" ? "document_validated" : "document_rejected",
            detail: state === "rejected" ? { ...detail, reason: "Ilegible: vuelve a escanearlo" } : detail,
            createdAt: reviewedAt,
          },
        ]
      : []),
  ]);
}

/** Every mandatory company document, valid well beyond the alert window unless overridden. */
function companyDocs(overrides: Partial<Record<RequirementId, Omit<DocSeed, "requirementId"> | null>> = {}): DocSeed[] {
  return MANDATORY_COMPANY_REQUIREMENTS.flatMap((req) => {
    const override = overrides[req.id];
    if (override === null) return [];
    const expiresIn = req.validityMonths === null ? null : req.validityMonths === 1 ? 25 : 200;
    return [{ requirementId: req.id, expiresIn, ...override }];
  });
}

/** What a worker needs to be let in (TPC route), plus extras. */
function workerDocs(extra: DocSeed[] = [], overrides: Partial<Record<RequirementId, Omit<DocSeed, "requirementId"> | null>> = {}) {
  const base: DocSeed[] = [
    { requirementId: "alta_ss" },
    { requirementId: "tpc", expiresIn: 900 },
    { requirementId: "aptitud_medica", expiresIn: 230 },
    { requirementId: "entrega_epis" },
    { requirementId: "info_riesgos" },
  ];
  return [
    ...base.flatMap((d) => (overrides[d.requirementId] === null ? [] : [{ ...d, ...overrides[d.requirementId] }])),
    ...extra,
  ];
}

type WorkerSeed = {
  firstName: string;
  surnames: string;
  dni: string;
  trade: string;
  category: string;
  roles?: string[];
  docs: DocSeed[];
};

type CompanySeed = {
  fields: Record<string, unknown>;
  docs: DocSeed[];
  workers: WorkerSeed[];
  assignment?: { chapterCodes: string[]; start: number; end: number; bookOrder: number; pss: boolean };
};

const COMPANIES: CompanySeed[] = [
  {
    fields: { legalName: "Montajes Steel Norte S.L.", taxId: cif("B3945281"), postalCode: "39600", city: "Maliaño", trades: ["steel_frame"], headcount: 14, permanentCount: 9, machinery: ["mewp", "welding"] },
    docs: companyDocs({ cert_tgss: { expiresIn: 5 } }),
    workers: [
      { firstName: "Sergio", surnames: "Fernández Cuesta", dni: dni("13820204"), trade: "steel_frame", category: "officer_1", roles: ["preventive_resource"], docs: workerDocs([{ requirementId: "formacion_nivel_basico_60h" }, { requirementId: "formacion_altura" }]) },
      { firstName: "Rubén", surnames: "Sainz Abascal", dni: dni("72093339"), trade: "steel_frame", category: "officer_2", docs: workerDocs([{ requirementId: "formacion_altura" }], { aptitud_medica: { expiresIn: -17 } }) },
      { firstName: "Ana", surnames: "Gutiérrez Mazo", dni: dni("20187871"), trade: "steel_frame", category: "officer_1", roles: ["machine_operator"], docs: workerDocs([{ requirementId: "formacion_maquinaria" }, { requirementId: "formacion_pemp", expiresIn: 700 }, { requirementId: "formacion_altura" }]) },
    ],
    assignment: { chapterCodes: ["03"], start: -60, end: 25, bookOrder: 3, pss: true },
  },
  {
    fields: { legalName: "Cubiertas Besaya S.L.", taxId: cif("B3911183"), postalCode: "39300", city: "Torrelavega", trades: ["roofing"], headcount: 6, permanentCount: 4 },
    docs: companyDocs({ poliza_rc_subcontrata: { expiresIn: 18 } }),
    workers: [
      { firstName: "Pedro", surnames: "Llata Ceballos", dni: dni("13760652"), trade: "roofing", category: "officer_1", roles: ["preventive_resource"], docs: workerDocs([{ requirementId: "formacion_nivel_basico_60h" }, { requirementId: "formacion_altura" }, { requirementId: "renuncia_vigilancia_salud" }], { aptitud_medica: null }) },
      { firstName: "Marcos", surnames: "Revuelta Gil", dni: dni("72458018"), trade: "roofing", category: "specialist_labourer", docs: workerDocs([{ requirementId: "formacion_prl_inicial" }, { requirementId: "formacion_prl_oficio" }, { requirementId: "formacion_altura" }], { tpc: null, entrega_epis: null }) },
    ],
    assignment: { chapterCodes: ["05"], start: -10, end: 40, bookOrder: 5, pss: true },
  },
  {
    fields: { legalName: "Aislamientos Cantábrico S.L.", taxId: cif("B3339071"), postalCode: "33400", city: "Avilés", trades: ["insulation"], headcount: 11, permanentCount: 5 },
    docs: companyDocs({ evaluacion_riesgos: { state: "requested" } }),
    workers: [
      { firstName: "Tomás", surnames: "Álvarez Menéndez", dni: dni("10901236"), trade: "insulation", category: "officer_1", docs: workerDocs([{ requirementId: "formacion_andamios" }]) },
    ],
    assignment: { chapterCodes: ["06"], start: 15, end: 70, bookOrder: 8, pss: false },
  },
  {
    fields: { legalName: "Instalaciones Térmicas Pas S.L.", taxId: cif("B3963062"), postalCode: "39470", city: "Renedo de Piélagos", trades: ["hvac", "plumbing"], headcount: 8, permanentCount: 6, isInstaller: true, installerReg: "39-RITE-0457" },
    docs: companyDocs({ poliza_rc_subcontrata: { state: "uploaded", expiresIn: 340 } }),
    workers: [
      { firstName: "Hugo", surnames: "Pérez Díaz", dni: "X1234567L", trade: "plumbing", category: "officer_1", docs: workerDocs() },
    ],
    assignment: { chapterCodes: ["11", "12"], start: -5, end: 60, bookOrder: 6, pss: true },
  },
  {
    fields: { legalName: "Electricidad Saja S.L.", taxId: "B39123450", postalCode: "39300", city: "Torrelavega", address: "C/ Ramón y Cajal 14", trades: ["electrical", "telecom"], headcount: 9, permanentCount: 6, isInstaller: true, installerReg: "39-IBTE-0218", reaNumber: "39-0004217", legalRep: "Marta Saiz Pérez", siteContact: "Iván Gómez Ruiz", siteContactPhone: "612 48 90 37" },
    docs: [
      ...companyDocs({ cert_aeat_contratistas: { expiresIn: -8 } }),
      { requirementId: "habilitacion_instalador" },
      { requirementId: "escrituras_036", state: "uploaded" },
    ],
    workers: [
      { firstName: "Iván", surnames: "Gómez Ruiz", dni: dni("72331581"), trade: "electrical", category: "officer_1", roles: ["preventive_resource"], docs: workerDocs([{ requirementId: "formacion_nivel_basico_60h" }], { tpc: { expiresIn: 12 } }) },
      { firstName: "Laura", surnames: "Cobo Fernández", dni: dni("20214914"), trade: "electrical", category: "officer_2", docs: workerDocs() },
    ],
    assignment: { chapterCodes: ["13", "14"], start: -12, end: 64, bookOrder: 7, pss: true },
  },
  {
    fields: { kind: "self_employed", legalName: "Javier Ruiz Pellón", taxId: "72145836B", postalCode: "39500", city: "Cabezón de la Sal", trades: ["carpentry"], headcount: 1, permanentCount: 1 },
    docs: companyDocs({ rnt_mensual: null }),
    workers: [
      { firstName: "Javier", surnames: "Ruiz Pellón", dni: "72145836B", trade: "carpentry", category: "self_employed", docs: workerDocs([], { aptitud_medica: null }).concat([{ requirementId: "renuncia_vigilancia_salud" }]) },
    ],
  },
  {
    fields: { legalName: "Pinturas Miera S.L.U.", taxId: cif("B3927123"), postalCode: "39727", city: "Liérganes", trades: ["painting"], headcount: 4, permanentCount: 3 },
    docs: companyDocs(),
    workers: [
      { firstName: "Lucía", surnames: "Pando Ríos", dni: dni("20447447"), trade: "painting", category: "officer_1", docs: workerDocs([{ requirementId: "formacion_andamios" }]) },
    ],
  },
  {
    fields: { legalName: "Excavaciones Asón S.L.", taxId: cif("B3958451"), postalCode: "39800", city: "Ramales de la Victoria", trades: ["earthworks", "foundations"], headcount: 10, permanentCount: 7, machinery: ["excavator"] },
    docs: companyDocs(),
    workers: [
      { firstName: "Óscar", surnames: "Ortiz Lavín", dni: dni("13914410"), trade: "earthworks", category: "officer_1", roles: ["machine_operator"], docs: workerDocs([{ requirementId: "formacion_maquinaria" }]) },
    ],
  },
];

/** Seeds the companies once per tenant; returns how many it created. */
export async function seedSubcontractors(ctx: Ctx, projectId: string, { files = true } = {}) {
  const existing = await db.query.subcontractors.findFirst({
    where: eq(subcontractors.tenantId, ctx.tenantId),
    columns: { id: true },
  });
  if (existing) return 0;

  for (const seed of COMPANIES) {
    const { id } = await createSubcontractor(ctx, {
      kind: "company",
      address: "Polígono Industrial, nave 4",
      phone: "942 000 000",
      preventionMode: "external_service",
      preventionEntity: "Prevención Cantabria SPA S.L.",
      preventionValidUntil: addMonths(today, 9),
      ...seed.fields,
    });
    for (const doc of seed.docs) await seedDoc(ctx, id, doc, files);
    for (const w of seed.workers) {
      const { id: workerId } = await createWorker(ctx, {
        subcontractorId: id,
        firstName: w.firstName,
        surnames: w.surnames,
        idDocument: w.dni,
        trade: w.trade,
        category: w.category,
        roles: w.roles ?? [],
        contractType: w.category === "self_employed" ? "self_employed" : "permanent",
        startDate: day(-200),
        ppeItems: ["helmet", "boots", "gloves", "hi_vis"],
      });
      for (const doc of w.docs) await seedDoc(ctx, id, { ...doc, workerId }, files);
    }
    if (seed.assignment) {
      const a = seed.assignment;
      await assignToProject(ctx, id, projectId, {
        chapterCodes: a.chapterCodes,
        plannedStart: day(a.start),
        plannedEnd: day(a.end),
        bookOrder: a.bookOrder,
        bookDate: day(Math.min(a.start, 0) - 14),
        cssInformed: true,
      });
      if (a.pss) await seedDoc(ctx, id, { requirementId: "adhesion_pss", projectId }, files);
    }
  }
  return COMPANIES.length;
}
